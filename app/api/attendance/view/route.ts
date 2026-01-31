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
    const date = searchParams.get("date");
    const studentId = searchParams.get("studentId");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }
    const where: any = {
      class: {
        schoolId: schoolId,
      },
    };

    // For students: only show their own attendance
    if (session.user.studentId) {
      where.studentId = session.user.studentId;
    } else {
      // For teachers/admins: can filter by student or class
      if (studentId) {
        where.studentId = studentId;
      }
      if (classId) {
        where.classId = classId;
      }
    }

    if (date) {
      const dateObj = new Date(date);
      where.date = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
    }

    if (startDate && endDate) {
      where.date = {
        gte: new Date(startDate),
        lte: new Date(endDate),
      };
    }
    const cacheKey = `attendance:${schoolId}:${session.user.studentId || "all"}:${classId || "all"}:${studentId || "all"}:${date || "range"}:${startDate || "na"}:${endDate || "na"}`;


    const cachedAtendances = await redis.get(cacheKey);
      console.log("✅ attendence served from Redis");

    if (cachedAtendances) {
      return NextResponse.json({ attendances: cachedAtendances }, { status: 200 });
    }

    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        student: session.user.studentId ? undefined : {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        class: {
          select: { id: true, name: true, section: true },
        },
        teacher: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: [
        { date: "desc" },
        { period: "asc" },
      ],
    });

    // Cache the result for 5 minutes
    await redis.set(cacheKey,attendances,{ex:60 * 5}); 


    return NextResponse.json({ attendances }, { status: 200 });
  } catch (error: any) {
    console.error("View attendance error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
