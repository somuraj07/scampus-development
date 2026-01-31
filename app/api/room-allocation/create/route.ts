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
        { message: "Only school admins can create room allocations" },
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

      if (schoolId) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { schoolId },
        });
      }
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { roomName, rows, columns, studentsPerBench, classIds } = await req.json();

    // Validation
    if (!roomName || !rows || !columns) {
      return NextResponse.json(
        { message: "Room name, rows, and columns are required" },
        { status: 400 }
      );
    }

    if (rows < 1 || columns < 1) {
      return NextResponse.json(
        { message: "Rows and columns must be at least 1" },
        { status: 400 }
      );
    }

    const studentsPerBenchValue = studentsPerBench === 2 ? 2 : 1;
    const totalCapacity = rows * columns * studentsPerBenchValue;

    if (totalCapacity > 200) {
      return NextResponse.json(
        { message: "Room capacity cannot exceed 200 students" },
        { status: 400 }
      );
    }

    // Validate classes if provided
    if (classIds && Array.isArray(classIds) && classIds.length > 0) {
      const classes = await prisma.class.findMany({
        where: {
          id: { in: classIds },
          schoolId: schoolId,
        },
      });

      if (classes.length !== classIds.length) {
        return NextResponse.json(
          { message: "Some classes not found or don't belong to your school" },
          { status: 400 }
        );
      }
    }

    // Create room allocation
    const roomAllocation = await prisma.roomAllocation.create({
      data: {
        roomName: roomName.trim(),
        rows: parseInt(rows),
        columns: parseInt(columns),
        studentsPerBench: studentsPerBenchValue,
        schoolId,
        classRooms: classIds && Array.isArray(classIds) && classIds.length > 0
          ? {
              create: classIds.map((classId: string) => ({
                classId,
              })),
            }
          : undefined,
      },
      include: {
        classRooms: {
          include: {
            class: {
              select: {
                id: true,
                name: true,
                section: true,
              },
            },
          },
        },
      },
    });

    // Invalidate cache
    await redis.del(`room-allocations:${schoolId}`);

    return NextResponse.json(
      { message: "Room allocation created successfully", roomAllocation },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Room allocation creation error:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "Room with this name already exists" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
