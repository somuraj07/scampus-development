import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import Razorpay from "razorpay";
import { redis } from "@/lib/redis";

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID!,
  key_secret: process.env.RAZORPAY_KEY_SECRET!,
});

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "STUDENT") {
      return NextResponse.json(
        { message: "Only students can book hostel cots" },
        { status: 403 }
      );
    }

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student profile not found" },
        { status: 400 }
      );
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const student = await prisma.student.findUnique({
        where: { id: session.user.studentId },
        select: { schoolId: true },
      });
      
      if (!student?.schoolId) {
        return NextResponse.json(
          { message: "School not found" },
          { status: 400 }
        );
      }
      
      schoolId = student.schoolId;
    }

    const { roomId, cotNumber } = await req.json();

    if (!roomId || !cotNumber) {
      return NextResponse.json(
        { message: "Room ID and cot number are required" },
        { status: 400 }
      );
    }

    // Check if room exists and belongs to the same school
    const room = await prisma.room.findFirst({
      where: {
        id: roomId,
        hostel: {
          schoolId: schoolId,
        },
      },
      include: {
        hostel: true,
        bookings: true,
      },
    });

    if (!room) {
      return NextResponse.json(
        { message: "Room not found" },
        { status: 404 }
      );
    }

    // Validate cot number
    if (cotNumber < 1 || cotNumber > room.cotCount) {
      return NextResponse.json(
        { message: `Cot number must be between 1 and ${room.cotCount}` },
        { status: 400 }
      );
    }

    // Check if cot is already booked
    const existingBooking = await prisma.cotBooking.findFirst({
      where: {
        roomId: roomId,
        cotNumber: parseInt(cotNumber),
      },
    });

    if (existingBooking) {
      return NextResponse.json(
        { message: "This cot is already booked" },
        { status: 400 }
      );
    }

    // Check if student already has a booking in any hostel
    const studentBooking = await prisma.cotBooking.findFirst({
      where: {
        studentId: session.user.studentId,
        schoolId: schoolId,
      },
    });

    if (studentBooking) {
      return NextResponse.json(
        { message: "You already have a hostel booking" },
        { status: 400 }
      );
    }

    // Create Razorpay order
    const amount = room.amount;
    let razorpayOrder;
    
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(amount * 100), // Convert to paise
        currency: "INR",
        receipt: `hostel_booking_${Date.now()}`,
        notes: {
          roomId,
          cotNumber: cotNumber.toString(),
          studentId: session.user.studentId,
        },
      });
    } catch (razorpayError: any) {
      console.error("Razorpay order creation error:", razorpayError);
      return NextResponse.json(
        { message: "Failed to create payment order", error: razorpayError.message },
        { status: 500 }
      );
    }

    // Create booking with PENDING status
    const booking = await prisma.cotBooking.create({
      data: {
        roomId: roomId,
        cotNumber: parseInt(cotNumber),
        studentId: session.user.studentId,
        schoolId: schoolId,
        amount: amount,
        paymentStatus: "PENDING",
        razorpayOrderId: razorpayOrder.id,
      },
      include: {
        room: {
          include: {
            hostel: {
              select: {
                id: true,
                name: true,
                address: true,
                gender: true,
              },
            },
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

    // Invalidate cache
    await redis.del(`hostels:${schoolId}`);
    await redis.del(`cot-bookings:${schoolId}`);

    return NextResponse.json(
      {
        message: "Booking created. Please complete payment.",
        booking,
        razorpayOrder: {
          id: razorpayOrder.id,
          amount: razorpayOrder.amount,
          currency: razorpayOrder.currency,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Hostel booking error:", error);
    
    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "This cot is already booked" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
