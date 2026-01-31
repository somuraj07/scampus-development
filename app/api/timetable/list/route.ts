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

    const { searchParams } = new URL(req.url);
    const classId = searchParams.get("classId");

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      if (session.user.role === "SCHOOLADMIN") {
        const adminSchool = await prisma.school.findFirst({
          where: { admins: { some: { id: session.user.id } } },
          select: { id: true },
        });
        schoolId = adminSchool?.id ?? null;
      } else if (session.user.role === "STUDENT" && session.user.studentId) {
        const student = await prisma.student.findUnique({
          where: { id: session.user.studentId },
          select: { schoolId: true },
        });
        schoolId = student?.schoolId ?? null;
      }
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found" },
        { status: 400 }
      );
    }

    // If classId is provided, get timetable for that class
    if (classId) {
      const cacheKey = `timetable:${classId}`;
      const cached = await redis.get(cacheKey);

      if (cached) {
        return NextResponse.json({ timetables: cached }, { status: 200 });
      }

      // Verify class belongs to school
      const classExists = await prisma.class.findFirst({
        where: {
          id: classId,
          schoolId: schoolId,
        },
      });

      if (!classExists) {
        return NextResponse.json(
          { message: "Class not found" },
          { status: 404 }
        );
      }

      const timetables = await prisma.timetable.findMany({
        where: {
          classId: classId,
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
    }

    // If no classId, get all timetables for the school
    if (session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Class ID is required" },
        { status: 400 }
      );
    }

    const timetables = await prisma.timetable.findMany({
      where: {
        class: {
          schoolId: schoolId,
        },
      },
      orderBy: [
        { classId: "asc" },
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

    return NextResponse.json({ timetables }, { status: 200 });
  } catch (error: any) {
    console.error("Timetable list error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
