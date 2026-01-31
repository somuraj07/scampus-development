import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

// GET: list appointments for current user (student or teacher)
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const userId = session.user.id;
    const role = session.user.role;

    let where: any = {};

  if (role === "STUDENT") {
    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student profile not found" },
        { status: 400 }
      );
    }
    where.studentId = session.user.studentId;
  } else if (role === "TEACHER") {
    where.teacherId = userId;
  } else {
    return NextResponse.json(
      { message: "Only students or teachers can view appointments" },
      { status: 403 }
    );
  }
   const cachedKey = `appointments:${role}:${userId}`;
   const cachedAppointments = await redis.get(cachedKey);
    if (cachedAppointments) {
      console.log("✅ Appointments served from Redis");
      return NextResponse.json({ appointments: cachedAppointments }, { status: 200 });
    }

    const appointments = await prisma.appointment.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    await redis.set(cachedKey,appointments,{ex:60 * 5}); // Cache for 5 minutes

    return NextResponse.json({ appointments });
  } catch (error: any) {
    console.error("List appointments error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST: create appointment (student)
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT") {
    return NextResponse.json(
      { message: "Only students can request appointments" },
      { status: 403 }
    );
  }

  try {
    const { teacherId, scheduledAt, note } = await req.json();

    if (!teacherId) {
      return NextResponse.json(
        { message: "teacherId is required" },
        { status: 400 }
      );
    }

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student profile not found" },
        { status: 400 }
      );
    }

    if (!session.user.schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const appointment = await prisma.appointment.create({
      data: {
        studentId: session.user.studentId,
        teacherId,
        schoolId: session.user.schoolId,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        note: note || null,
        status: "PENDING",
      },
    });

    return NextResponse.json(
      { message: "Appointment requested", appointment },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Create appointment error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

