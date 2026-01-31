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
    const status = searchParams.get("status");

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

    // For students: only show their own TC requests
    if (session.user.studentId) {
      where.studentId = session.user.studentId;
    }

    if (status) {
      where.status = status;
    }
   const cachedKey = `tcs:${schoolId}:${session.user.studentId || "all"}:${status || "all"}`;
   const cachedTcs = await redis.get(cachedKey);
    if (cachedTcs) {
      console.log("✅ TCs served from Redis");
      return NextResponse.json({ tcs: cachedTcs }, { status: 200 });
    }
    const tcs = await prisma.transferCertificate.findMany({
      where,
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            class: {
              select: { id: true, name: true, section: true },
            },
          },
        },
        requestedBy: {
          select: { id: true, name: true, email: true },
        },
        approvedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    await redis.set(cachedKey,tcs,{ex:60 * 5}); // Cache for 5 minutes
    return NextResponse.json({ tcs }, { status: 200 });
  } catch (error: any) {
    console.error("List TC error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
