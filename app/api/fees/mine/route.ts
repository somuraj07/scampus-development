import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "STUDENT" || !session.user.studentId) {
    return NextResponse.json(
      { message: "Only students can view their fee details" },
      { status: 403 }
    );
  }

  try {
    const cachedKey = `fees:${session.user.studentId}`;
    const cachedFee = await redis.get(cachedKey);

    if (cachedFee) {
      console.log("✅ Fee details served from Redis");
      return NextResponse.json({ fee: cachedFee }, { status: 200 });
    }
    const fee = await prisma.studentFee.findUnique({
      where: { studentId: session.user.studentId },
    });
    await redis.set(cachedKey,fee,{ex:60 * 5}); // Cache for 5 minutes

    if (!fee) {
      return NextResponse.json(
        { message: "Fee details not found for this student" },
        { status: 404 }
      );
    }

    return NextResponse.json({ fee });
  } catch (error: any) {
    console.error("Fetch student fee error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

