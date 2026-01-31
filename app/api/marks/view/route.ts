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
    const studentId = searchParams.get("studentId");
    const subject = searchParams.get("subject");

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

    // For students: only show their own marks
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

    if (subject) {
      where.subject = subject;
    }
    const cacheKey = `marks:${schoolId}:${session.user.studentId || "all"}:${classId || "all"}:${studentId || "all"}:${subject || "all"}`;
    const cachedMarks = await redis.get(cacheKey);
    if (cachedMarks) {
      console.log("✅ Marks served from Redis");
      return NextResponse.json({ marks: cachedMarks }, { status: 200 });
    }
    const marks = await prisma.mark.findMany({
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
      orderBy: {
        createdAt: "desc",
      },
    });
    await redis.set(cacheKey, marks, { ex: 60 * 5 }); // Cache for 5 minutes
    return NextResponse.json({ marks }, { status: 200 });
  } catch (error: any) {
    console.error("View marks error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
