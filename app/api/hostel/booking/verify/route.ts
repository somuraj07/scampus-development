import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import crypto from "crypto";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "STUDENT" || !session.user.studentId) {
      return NextResponse.json(
        { message: "Only students can verify hostel booking payments" },
        { status: 403 }
      );
    }

    const {
      bookingId,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
    } = await req.json();

    if (!bookingId || !razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return NextResponse.json(
        { message: "Missing required payment verification fields" },
        { status: 400 }
      );
    }

    // Find the booking
    const booking = await prisma.cotBooking.findFirst({
      where: {
        id: bookingId,
        studentId: session.user.studentId,
        razorpayOrderId: razorpay_order_id,
        paymentStatus: "PENDING",
      },
      include: {
        room: {
          include: {
            hostel: true,
          },
        },
      },
    });

    if (!booking) {
      return NextResponse.json(
        { message: "Booking not found or already processed" },
        { status: 404 }
      );
    }

    // Verify signature
    const text = `${razorpay_order_id}|${razorpay_payment_id}`;
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
      .update(text)
      .digest("hex");

    if (generatedSignature !== razorpay_signature) {
      await prisma.cotBooking.update({
        where: { id: bookingId },
        data: {
          paymentStatus: "FAILED",
        },
      });

      return NextResponse.json(
        { message: "Payment verification failed. Invalid signature." },
        { status: 400 }
      );
    }

    // Update booking as paid
    const updatedBooking = await prisma.cotBooking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: "PAID",
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
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
          select: {
            id: true,
            roomNumber: true,
            floor: true,
            cotCount: true,
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
    await redis.del(`hostels:${booking.schoolId}`);
    await redis.del(`cot-bookings:${booking.schoolId}`);

    return NextResponse.json(
      {
        message: "Payment verified successfully. Booking confirmed!",
        booking: updatedBooking,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Payment verification error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
