import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Only school admins can assign students" },
        { status: 403 }
      );
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { roomAllocationId, studentIds } = await req.json();

    if (!roomAllocationId || !studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return NextResponse.json(
        { message: "Room allocation ID and student IDs array are required" },
        { status: 400 }
      );
    }

    // Get room allocation
    const roomAllocation = await prisma.roomAllocation.findFirst({
      where: {
        id: roomAllocationId,
        schoolId: schoolId,
      },
      include: {
        studentAssignments: {
          include: {
            student: {
              include: {
                class: true,
              },
            },
          },
        },
      },
    });

    if (!roomAllocation) {
      return NextResponse.json(
        { message: "Room allocation not found" },
        { status: 404 }
      );
    }

    // Get students with their classes and user info
    const students = await prisma.student.findMany({
      where: {
        id: { in: studentIds },
        schoolId: schoolId,
      },
      include: {
        class: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (students.length !== studentIds.length) {
      return NextResponse.json(
        { message: "Some students not found" },
        { status: 400 }
      );
    }

    // Check for duplicates
    const uniqueStudentIds = Array.from(new Set(studentIds));
    if (uniqueStudentIds.length !== studentIds.length) {
      return NextResponse.json(
        { message: "Duplicate students are not allowed" },
        { status: 400 }
      );
    }

    // Build position map from existing assignments
    const positionMap = new Map<string, { studentId: string; classId: string | null }>();
    for (const existing of roomAllocation.studentAssignments) {
      const key = `${existing.row}-${existing.column}-${existing.benchPosition}`;
      positionMap.set(key, {
        studentId: existing.studentId,
        classId: existing.student.classId,
      });
    }

    // Remove students that are already assigned (we'll reassign them)
    const existingStudentIds = new Set(
      roomAllocation.studentAssignments.map((a) => a.studentId)
    );
    for (const studentId of existingStudentIds) {
      if (uniqueStudentIds.includes(studentId)) {
        // Remove existing assignments for these students
        for (const [key, value] of positionMap.entries()) {
          if (value.studentId === studentId) {
            positionMap.delete(key);
          }
        }
      }
    }

    // Auto-assignment logic
    const assignments: Array<{
      studentId: string;
      row: number;
      column: number;
      benchPosition: number;
    }> = [];

    const isPositionAvailable = (row: number, column: number, benchPosition: number, studentClassId: string | null): boolean => {
      const key = `${row}-${column}-${benchPosition}`;
      
      // Check if position is already taken
      if (positionMap.has(key)) {
        return false;
      }

      // Check constraints based on studentsPerBench
      if (roomAllocation.studentsPerBench === 1) {
        // Cannot be side-by-side, front, or back for same class
        const adjacentPositions = [
          `${row}-${column - 1}-1`, // Left
          `${row}-${column + 1}-1`, // Right
          `${row - 1}-${column}-1`, // Front
          `${row + 1}-${column}-1`, // Back
        ];

        for (const adjKey of adjacentPositions) {
          const adj = positionMap.get(adjKey);
          if (adj && adj.classId === studentClassId && adj.classId) {
            return false;
          }
        }
      } else {
        // Cannot be side-by-side on same bench or adjacent columns
        const sameBenchPos = benchPosition === 1 ? 2 : 1;
        const sameBenchKey = `${row}-${column}-${sameBenchPos}`;
        const sameBench = positionMap.get(sameBenchKey);
        if (sameBench && sameBench.classId === studentClassId && sameBench.classId) {
          return false;
        }

        // Check left/right columns
        const checkSide = (checkCol: number) => {
          const key1 = `${row}-${checkCol}-1`;
          const key2 = `${row}-${checkCol}-2`;
          const adj1 = positionMap.get(key1);
          const adj2 = positionMap.get(key2);
          return (adj1 && adj1.classId === studentClassId && adj1.classId) ||
                 (adj2 && adj2.classId === studentClassId && adj2.classId);
        };

        if (column > 1 && checkSide(column - 1)) {
          return false;
        }
        if (column < roomAllocation.columns && checkSide(column + 1)) {
          return false;
        }
      }

      return true;
    };

    // Try to assign each student
    const unassignedStudents: typeof students = [];

    // Process students in a smart order: group by class to optimize placement
    const studentsByClass = new Map<string | null, typeof students>();
    for (const student of students) {
      const classId = student.classId;
      if (!studentsByClass.has(classId)) {
        studentsByClass.set(classId, []);
      }
      studentsByClass.get(classId)!.push(student);
    }

    // Try to assign all students
    for (const [, classStudents] of studentsByClass) {
      for (const student of classStudents) {
        let assigned = false;

        // Try all positions systematically
        for (let row = 1; row <= roomAllocation.rows && !assigned; row++) {
          for (let col = 1; col <= roomAllocation.columns && !assigned; col++) {
            for (let benchPos = 1; benchPos <= roomAllocation.studentsPerBench && !assigned; benchPos++) {
              if (isPositionAvailable(row, col, benchPos, student.classId)) {
                assignments.push({
                  studentId: student.id,
                  row,
                  column: col,
                  benchPosition: benchPos,
                });

                // Mark position as taken immediately
                const key = `${row}-${col}-${benchPos}`;
                positionMap.set(key, {
                  studentId: student.id,
                  classId: student.classId,
                });

                assigned = true;
              }
            }
          }
        }

        if (!assigned) {
          unassignedStudents.push(student);
        }
      }
    }

    // Check if all students could be assigned
    if (unassignedStudents.length > 0) {
      return NextResponse.json(
        { 
          message: `Could not assign ${unassignedStudents.length} student(s) due to seating constraints. Please remove some existing assignments or add more seats.`,
          unassigned: unassignedStudents.map(s => s.user?.name || s.id),
          partialAssignments: assignments,
        },
        { status: 400 }
      );
    }

    // Delete existing assignments for these students
    await prisma.roomStudentAssignment.deleteMany({
      where: {
        roomAllocationId,
        studentId: { in: uniqueStudentIds },
      },
    });

    // Create new assignments
    if (assignments.length > 0) {
      await prisma.roomStudentAssignment.createMany({
        data: assignments.map((assignment) => ({
          roomAllocationId,
          studentId: assignment.studentId,
          row: assignment.row,
          column: assignment.column,
          benchPosition: assignment.benchPosition,
        })),
      });
    }

    // Invalidate cache
    await redis.del(`room-allocations:${schoolId}`);

    return NextResponse.json(
      { 
        message: `Successfully assigned ${assignments.length} student(s)`,
        assignments,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Auto-assignment error:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "Duplicate assignment detected" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
