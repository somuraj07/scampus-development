import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

// GET messages for an appointment
export async function GET(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const appointmentId = searchParams.get("appointmentId");

  if (!appointmentId) {
    return NextResponse.json(
      { message: "appointmentId is required" },
      { status: 400 }
    );
  }

  try {
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      return NextResponse.json(
        { message: "Appointment not found" },
        { status: 404 }
      );
    }

    const userId = session.user.id;

    if (
      appointment.studentId !== session.user.studentId &&
      appointment.teacherId !== userId
    ) {
      return NextResponse.json(
        { message: "You are not part of this appointment" },
        { status: 403 }
      );
    }
    const cachedKey = `messages:${appointmentId}`;
    const cachedMessages = await redis.get(cachedKey);
    if (cachedMessages) {
      console.log("✅ Messages served from Redis");
      return NextResponse.json({ messages: cachedMessages }, { status: 200 });
    }
    const messages = await prisma.chatMessage.findMany({
      where: { appointmentId },
      orderBy: { createdAt: "asc" },
    });
    await redis.set(cachedKey,messages,{ex:60 * 5}); // Cache for 5 minutes

    return NextResponse.json({ messages });
  } catch (error: any) {
    console.error("List messages error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

// POST create message
export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const { appointmentId, content } = await req.json();

    if (!appointmentId || !content) {
      return NextResponse.json(
        { message: "appointmentId and content are required" },
        { status: 400 }
      );
    }

    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      return NextResponse.json(
        { message: "Appointment not found" },
        { status: 404 }
      );
    }

    const userId = session.user.id;
    if (
      appointment.studentId !== session.user.studentId &&
      appointment.teacherId !== userId
    ) {
      return NextResponse.json(
        { message: "You are not part of this appointment" },
        { status: 403 }
      );
    }

    if (appointment.status !== "APPROVED") {
      return NextResponse.json(
        { message: "Chat is only available for approved appointments" },
        { status: 400 }
      );
    }

    const message = await prisma.chatMessage.create({
      data: {
        appointmentId,
        senderId: userId,
        content,
      },
    });

    return NextResponse.json(message, { status: 201 });
  } catch (error: any) {
    console.error("Create message error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}


