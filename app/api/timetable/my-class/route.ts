import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "STUDENT" || !session.user.studentId) {
      return NextResponse.json(
        { message: "Only students can view their class timetable" },
        { status: 403 }
      );
    }

    // Get student's class
    const student = await prisma.student.findUnique({
      where: { id: session.user.studentId },
      select: {
        classId: true,
      },
    });

    if (!student || !student.classId) {
      return NextResponse.json(
        { message: "Student is not assigned to a class" },
        { status: 400 }
      );
    }

    const cacheKey = `timetable:${student.classId}`;
    const cached = await redis.get(cacheKey);

    if (cached) {
      return NextResponse.json({ timetables: cached }, { status: 200 });
    }

    // Get timetable for student's class
    const timetables = await prisma.timetable.findMany({
      where: {
        classId: student.classId,
      },
      orderBy: [
        { day: "asc" },
        { period: "asc" },
      ],
      include: {
        class: {
          select: {
            id: true,
            name: true,
            section: true,
          },
        },
      },
    });

    await redis.set(cacheKey, timetables, { ex: 60 * 60 }); // Cache for 1 hour

    return NextResponse.json({ timetables }, { status: 200 });
  } catch (error: any) {
    console.error("My class timetable error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
