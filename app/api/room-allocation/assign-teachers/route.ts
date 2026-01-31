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
        { message: "Only school admins can assign teachers" },
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

    const { roomAllocationId, teacherIds } = await req.json();

    if (!roomAllocationId || !teacherIds || !Array.isArray(teacherIds)) {
      return NextResponse.json(
        { message: "Room allocation ID and teacher IDs array are required" },
        { status: 400 }
      );
    }

    // Check for duplicates
    const uniqueTeacherIds = Array.from(new Set(teacherIds));
    if (uniqueTeacherIds.length !== teacherIds.length) {
      return NextResponse.json(
        { message: "Duplicate teachers are not allowed" },
        { status: 400 }
      );
    }

    // Get room allocation
    const roomAllocation = await prisma.roomAllocation.findFirst({
      where: {
        id: roomAllocationId,
        schoolId: schoolId,
      },
    });

    if (!roomAllocation) {
      return NextResponse.json(
        { message: "Room allocation not found" },
        { status: 404 }
      );
    }

    // Validate teachers
    const teachers = await prisma.user.findMany({
      where: {
        id: { in: uniqueTeacherIds },
        role: "TEACHER",
        schoolId: schoolId,
      },
    });

    if (teachers.length !== uniqueTeacherIds.length) {
      return NextResponse.json(
        { message: "Some teachers not found or don't belong to your school" },
        { status: 400 }
      );
    }

    // Delete existing assignments
    await prisma.roomTeacherAssignment.deleteMany({
      where: {
        roomAllocationId,
      },
    });

    // Create new assignments
    if (uniqueTeacherIds.length > 0) {
      await prisma.roomTeacherAssignment.createMany({
        data: uniqueTeacherIds.map((teacherId: string) => ({
          roomAllocationId,
          teacherId,
        })),
      });
    }

    // Invalidate cache
    await redis.del(`room-allocations:${schoolId}`);

    return NextResponse.json(
      { message: "Teachers assigned successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Teacher assignment error:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "Duplicate teacher assignment detected" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
