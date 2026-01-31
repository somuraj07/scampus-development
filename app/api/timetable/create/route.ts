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
        { message: "Only school admins can manage timetables" },
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

    const { classId, day, period, type, subject, teacherName, startTime, endTime } = await req.json();

    // Validation
    if (!classId || !day || !period || !type) {
      return NextResponse.json(
        { message: "Class ID, day, period, and type are required" },
        { status: 400 }
      );
    }

    const validDays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    if (!validDays.includes(day.toUpperCase())) {
      return NextResponse.json(
        { message: "Invalid day. Must be MONDAY-SATURDAY" },
        { status: 400 }
      );
    }

    if (period < 1 || period > 8) {
      return NextResponse.json(
        { message: "Period must be between 1 and 8" },
        { status: 400 }
      );
    }

    const validTypes = ["SUBJECT", "BREAK", "LUNCH"];
    if (!validTypes.includes(type.toUpperCase())) {
      return NextResponse.json(
        { message: "Invalid type. Must be SUBJECT, BREAK, or LUNCH" },
        { status: 400 }
      );
    }

    // Check if class exists and belongs to the school
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

    // Create or update timetable entry
    const timetable = await prisma.timetable.upsert({
      where: {
        classId_day_period: {
          classId,
          day: day.toUpperCase(),
          period: parseInt(period),
        },
      },
      update: {
        type: type.toUpperCase(),
        subject: type.toUpperCase() === "SUBJECT" ? subject || null : null,
        teacherName: type.toUpperCase() === "SUBJECT" ? teacherName || null : null,
        startTime: startTime || null,
        endTime: endTime || null,
      },
      create: {
        classId,
        day: day.toUpperCase(),
        period: parseInt(period),
        type: type.toUpperCase(),
        subject: type.toUpperCase() === "SUBJECT" ? subject || null : null,
        teacherName: type.toUpperCase() === "SUBJECT" ? teacherName || null : null,
        startTime: startTime || null,
        endTime: endTime || null,
      },
    });

    // Invalidate cache
    await redis.del(`timetable:${classId}`);
    await redis.del(`timetable:${classId}:${day.toUpperCase()}`);

    return NextResponse.json(
      { message: "Timetable entry saved successfully", timetable },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Timetable creation error:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "Timetable entry already exists for this class, day, and period" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
