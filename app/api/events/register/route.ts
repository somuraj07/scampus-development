import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { eventId } = await req.json();

    if (!eventId) {
      return NextResponse.json(
        { message: "Event ID is required" },
        { status: 400 }
      );
    }

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student record not found" },
        { status: 400 }
      );
    }

    const studentId = session.user.studentId;
    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify event exists and belongs to student's school
    const event = await prisma.event.findFirst({
      where: {
        id: eventId,
        schoolId: schoolId,
      },
    });

    if (!event) {
      return NextResponse.json(
        { message: "Event not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    // Verify student can register (event must be for their class or school-wide)
    if (event.classId) {
      const student = await prisma.student.findUnique({
        where: { id: studentId },
        select: { classId: true },
      });

      if (student?.classId !== event.classId) {
        return NextResponse.json(
          { message: "This event is not available for your class" },
          { status: 403 }
        );
      }
    }

    // Check if already registered
    const existingRegistration = await prisma.eventRegistration.findUnique({
      where: {
        eventId_studentId: {
          eventId: eventId,
          studentId: studentId,
        },
      },
    });

    if (existingRegistration) {
      return NextResponse.json(
        { message: "You are already registered for this event", registration: existingRegistration },
        { status: 400 }
      );
    }

    // Create registration
    const registration = await prisma.eventRegistration.create({
      data: {
        eventId: eventId,
        studentId: studentId,
        paymentStatus: "PENDING", // Payment integration will be added later
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            description: true,
            amount: true,
            eventDate: true,
          },
        },
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
      },
    });

    return NextResponse.json(
      {
        message: "Successfully registered for the event",
        registration,
        note: "Payment integration can be added later",
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Register event error:", error);

    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "You are already registered for this event" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
