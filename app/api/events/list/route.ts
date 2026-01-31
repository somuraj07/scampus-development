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
    const teacherId = searchParams.get("teacherId");

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const where: any = {
      schoolId: schoolId,
    };

    // For students: show events for their class
    if (session.user.studentId) {
      const student = await prisma.student.findUnique({
        where: { id: session.user.studentId },
        select: { classId: true },
      });

      if (student?.classId) {
        where.OR = [
          { classId: student.classId },
          { classId: null }, // School-wide events
        ];
      } else {
        where.classId = null; // Only school-wide events
      }
    } else {
      // For teachers/admins: can filter by class or teacher
      if (classId) {
        where.classId = classId;
      }
      if (teacherId) {
        where.teacherId = teacherId;
      }
    }
  const cachedKey = `events:${schoolId}:${session.user.studentId || "all"}:${classId || "all"}:${teacherId || "all"}`;
    const cachedEvents = await redis.get(cachedKey);
    if (cachedEvents) {
      console.log("✅ Events served from Redis");
      return NextResponse.json({ events: cachedEvents }, { status: 200 });
    }
    const events = await prisma.event.findMany({
      where,
      include: {
        class: {
          select: { id: true, name: true, section: true },
        },
        teacher: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { registrations: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
   await redis.set(cachedKey,events,{ex:60 * 5}); // Cache for 5 minutes
    // For students, also include registration status
    if (session.user.studentId) {
      const eventsWithRegistration = await Promise.all(
        events.map(async (event) => {
          const registration = await prisma.eventRegistration.findUnique({
            where: {
              eventId_studentId: {
                eventId: event.id,
                studentId: session.user.studentId!,
              },
            },
          });

          return {
            ...event,
            isRegistered: !!registration,
            registrationStatus: registration?.paymentStatus || null,
          };
        })
      );

      return NextResponse.json({ events: eventsWithRegistration }, { status: 200 });
    }

    return NextResponse.json({ events }, { status: 200 });
  } catch (error: any) {
    console.error("List events error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
