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

    // Only STUDENT can book seats
    if (session.user.role !== "STUDENT") {
      return NextResponse.json(
        { message: "Only students can book bus seats" },
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
      // Try to get schoolId from student profile
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

    const { busId, seatNumber, routeId } = await req.json();

    if (!busId || !seatNumber || !routeId) {
      return NextResponse.json(
        { message: "Bus ID, seat number, and route (location) are required" },
        { status: 400 }
      );
    }

    // Check if bus and route exist and belong to the same school
    const bus = await prisma.bus.findFirst({
      where: {
        id: busId,
        schoolId: schoolId,
      },
      include: {
        routes: {
          where: { id: routeId },
        },
        bookings: true,
      },
    });

    if (!bus) {
      return NextResponse.json(
        { message: "Bus not found" },
        { status: 404 }
      );
    }

    const route = bus.routes.find((r) => r.id === routeId);
    if (!route) {
      return NextResponse.json(
        { message: "Route/location not found for this bus" },
        { status: 404 }
      );
    }

    // Validate seat number
    if (seatNumber < 1 || seatNumber > bus.totalSeats) {
      return NextResponse.json(
        { message: `Seat number must be between 1 and ${bus.totalSeats}` },
        { status: 400 }
      );
    }

    // Check if seat is already booked
    const existingBooking = await prisma.busBooking.findFirst({
      where: {
        busId: busId,
        seatNumber: parseInt(seatNumber),
      },
    });

    if (existingBooking) {
      return NextResponse.json(
        { message: "This seat is already booked" },
        { status: 400 }
      );
    }

    // Check if student already has a booking for this bus
    const studentBooking = await prisma.busBooking.findFirst({
      where: {
        busId: busId,
        studentId: session.user.studentId,
      },
    });

    if (studentBooking) {
      return NextResponse.json(
        { message: "You have already booked a seat on this bus" },
        { status: 400 }
      );
    }

    // Create Razorpay order
    const amount = route.amount;
    let razorpayOrder;
    
    try {
      razorpayOrder = await razorpay.orders.create({
        amount: Math.round(amount * 100), // Convert to paise
        currency: "INR",
        receipt: `bus_booking_${Date.now()}`,
        notes: {
          busId,
          routeId,
          seatNumber: seatNumber.toString(),
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
    const booking = await prisma.busBooking.create({
      data: {
        busId: busId,
        routeId: routeId,
        studentId: session.user.studentId,
        seatNumber: parseInt(seatNumber),
        schoolId: schoolId,
        amount: amount,
        paymentStatus: "PENDING",
        razorpayOrderId: razorpayOrder.id,
      },
      include: {
        bus: {
          select: {
            id: true,
            busNumber: true,
            driverName: true,
            driverNumber: true,
            time: true,
            totalSeats: true,
          },
        },
        route: {
          select: {
            id: true,
            location: true,
            amount: true,
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
    await redis.del(`buses:${schoolId}`);
    await redis.del(`bus-bookings:${schoolId}`);

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
    console.error("Bus booking error:", error);
    
    if (error?.code === "P2002") {
      return NextResponse.json(
        { message: "This seat is already booked" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}