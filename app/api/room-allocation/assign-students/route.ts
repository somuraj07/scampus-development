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

    const { roomAllocationId, assignments } = await req.json();

    if (!roomAllocationId || !assignments || !Array.isArray(assignments)) {
      return NextResponse.json(
        { message: "Room allocation ID and assignments array are required" },
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
        classRooms: {
          include: {
            class: true,
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

    // Validate assignments
    const studentIds = new Set<string>();
    const positions = new Set<string>();

    for (const assignment of assignments) {
      const { studentId, row, column, benchPosition } = assignment;

      // Check for duplicate students
      if (studentIds.has(studentId)) {
        return NextResponse.json(
          { message: `Student ${studentId} is assigned multiple times` },
          { status: 400 }
        );
      }
      studentIds.add(studentId);

      // Validate position
      if (row < 1 || row > roomAllocation.rows || column < 1 || column > roomAllocation.columns) {
        return NextResponse.json(
          { message: `Invalid position: row ${row}, column ${column}` },
          { status: 400 }
        );
      }

      const benchPos = benchPosition || 1;
      if (benchPos < 1 || benchPos > roomAllocation.studentsPerBench) {
        return NextResponse.json(
          { message: `Invalid bench position: ${benchPos}` },
          { status: 400 }
        );
      }

      const posKey = `${row}-${column}-${benchPos}`;
      if (positions.has(posKey)) {
        return NextResponse.json(
          { message: `Position (${row}, ${column}, ${benchPos}) is already assigned` },
          { status: 400 }
        );
      }
      positions.add(posKey);
    }

    // Get all students to check classes
    const studentIdsArray = Array.from(studentIds);
    const students = await prisma.student.findMany({
      where: {
        id: { in: studentIdsArray },
        schoolId: schoolId,
      },
      include: {
        class: true,
      },
    });

    if (students.length !== studentIdsArray.length) {
      return NextResponse.json(
        { message: "Some students not found" },
        { status: 400 }
      );
    }

    // Check seating constraints
    const studentMap = new Map(students.map(s => [s.id, s]));
    const positionMap = new Map<string, { studentId: string; classId: string | null }>();

    // Add existing assignments
    for (const existing of roomAllocation.studentAssignments) {
      const key = `${existing.row}-${existing.column}-${existing.benchPosition}`;
      positionMap.set(key, {
        studentId: existing.studentId,
        classId: existing.student.classId,
      });
    }

    // Check new assignments against constraints
    for (const assignment of assignments) {
      const { studentId, row, column, benchPosition } = assignment;
      const student = studentMap.get(studentId);
      if (!student) continue;

      const benchPos = benchPosition || 1;
      const key = `${row}-${column}-${benchPos}`;

      // Check constraints based on studentsPerBench
      if (roomAllocation.studentsPerBench === 1) {
        // Cannot be side-by-side, front, or back
        const adjacentPositions = [
          `${row}-${column - 1}-1`, // Left
          `${row}-${column + 1}-1`, // Right
          `${row - 1}-${column}-1`, // Front
          `${row + 1}-${column}-1`, // Back
        ];

        for (const adjKey of adjacentPositions) {
          const adj = positionMap.get(adjKey);
          if (adj && adj.classId === student.classId && adj.classId) {
            return NextResponse.json(
              { message: `Student from class ${student.class?.name} cannot be placed adjacent to another student from the same class (1 student per bench constraint)` },
              { status: 400 }
            );
          }
        }
      } else {
        // Cannot be side-by-side on same bench, but can be front/back
        // Check same bench (different benchPosition)
        const sameBenchPos = benchPos === 1 ? 2 : 1;
        const sameBenchKey = `${row}-${column}-${sameBenchPos}`;
        const sameBench = positionMap.get(sameBenchKey);
        if (sameBench && sameBench.classId === student.classId && sameBench.classId) {
          return NextResponse.json(
            { message: `Student from class ${student.class?.name} cannot be placed side-by-side on the same bench with another student from the same class` },
            { status: 400 }
          );
        }

        // Check left/right (same row, adjacent column, any bench position)
        const checkSide = (checkRow: number, checkCol: number) => {
          const key1 = `${checkRow}-${checkCol}-1`;
          const key2 = `${checkRow}-${checkCol}-2`;
          const adj1 = positionMap.get(key1);
          const adj2 = positionMap.get(key2);
          return (adj1 && adj1.classId === student.classId && adj1.classId) ||
                 (adj2 && adj2.classId === student.classId && adj2.classId);
        };

        // Check left
        if (column > 1 && checkSide(row, column - 1)) {
          return NextResponse.json(
            { message: `Student from class ${student.class?.name} cannot be placed side-by-side with another student from the same class` },
            { status: 400 }
          );
        }

        // Check right
        if (column < roomAllocation.columns && checkSide(row, column + 1)) {
          return NextResponse.json(
            { message: `Student from class ${student.class?.name} cannot be placed side-by-side with another student from the same class` },
            { status: 400 }
          );
        }
      }

      positionMap.set(key, {
        studentId,
        classId: student.classId,
      });
    }

    // Delete existing assignments for these students
    await prisma.roomStudentAssignment.deleteMany({
      where: {
        roomAllocationId,
        studentId: { in: studentIdsArray },
      },
    });

    // Create new assignments
    await prisma.roomStudentAssignment.createMany({
      data: assignments.map((assignment: any) => ({
        roomAllocationId,
        studentId: assignment.studentId,
        row: parseInt(assignment.row),
        column: parseInt(assignment.column),
        benchPosition: assignment.benchPosition || 1,
      })),
    });

    // Invalidate cache
    await redis.del(`room-allocations:${schoolId}`);

    return NextResponse.json(
      { message: "Students assigned successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Student assignment error:", error);

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
