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
    const originalStudentId = searchParams.get("originalStudentId");

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

    if (originalStudentId) {
      where.originalStudentId = originalStudentId;
    }
    const cachedKey = `studentHistories:${schoolId}:${originalStudentId || "all"}`;
    const cachedHistories = await redis.get(cachedKey);
    if (cachedHistories) {
      console.log("✅ Student histories served from Redis");
      return NextResponse.json({ histories: cachedHistories }, { status: 200 });
    }
    const histories = await prisma.studentHistory.findMany({
      where,
      orderBy: {
        deactivatedAt: "desc",
      },
    });
    await redis.set(cachedKey,histories,{ex:60 * 5}); // Cache for 5 minutes

    return NextResponse.json({ histories }, { status: 200 });
  } catch (error: any) {
    console.error("List student history error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
