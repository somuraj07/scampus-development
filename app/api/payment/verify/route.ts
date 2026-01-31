import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import crypto from "crypto";

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT" || !session.user.studentId) {
    return NextResponse.json(
      { message: "Only students can verify their payments" },
      { status: 403 }
    );
  }

  try {
    const body = await req.json();

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      amount,
    } = body;

    if (
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature ||
      typeof amount !== "number"
    ) {
      return NextResponse.json(
        { message: "Missing required payment fields" },
        { status: 400 }
      );
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keySecret) {
      return NextResponse.json(
        { message: "Razorpay secret not configured" },
        { status: 500 }
      );
    }

    const bodyString = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac("sha256", keySecret)
      .update(bodyString)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return NextResponse.json(
        { message: "Invalid payment signature" },
        { status: 400 }
      );
    }

    const studentId = session.user.studentId!;

    // NOTE: Avoid long-running DB transactions (can fail with Accelerate / serverless limits)
    // Do the two operations sequentially instead.

    const fee = await prisma.studentFee.findUnique({
      where: { studentId },
    });

    if (!fee) {
      return NextResponse.json(
        { message: "Fee details not found for this student" },
        { status: 404 }
      );
    }

    const newAmountPaid = fee.amountPaid + amount;
    const newRemaining = Math.max(fee.finalFee - newAmountPaid, 0);

    const payment = await prisma.payment.create({
      data: {
        studentId,
        amount,
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id,
        razorpaySignature: razorpay_signature,
        status: "SUCCESS",
      },
    });

    const updatedFee = await prisma.studentFee.update({
      where: { studentId },
      data: {
        amountPaid: newAmountPaid,
        remainingFee: newRemaining,
      },
    });

    return NextResponse.json({ payment, fee: updatedFee }, { status: 200 });
  } catch (error: any) {
    console.error("Verify payment error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

