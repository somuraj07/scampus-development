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

  const isAdmin = session.user.role === "SCHOOLADMIN" || session.user.role === "SUPERADMIN";
  if (!isAdmin) {
    return NextResponse.json(
      { message: "Only admins can view fee summary" },
      { status: 403 }
    );
  }

  try {
    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }
   const cachedKey = `feeSummary:${schoolId}`;
    const cachedSummary = await redis.get(cachedKey);
    if (cachedSummary) {
      console.log("✅ Fee summary served from Redis");
      return NextResponse.json({ summary: cachedSummary }, { status: 200 });
    }
    const fees = await prisma.studentFee.findMany({
      where: { student: { schoolId } },
      include: {
        student: {
          select: {
            id: true,
            class: { select: { id: true, name: true, section: true } },
            user: { select: { id: true, name: true, email: true } },
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    });
    await redis.set(cachedKey,fees,{ex:60 * 5}); // Cache for 5 minutes

    const stats = fees.reduce(
      (acc, fee) => {
        acc.totalStudents += 1;
        acc.totalCollected += fee.amountPaid;
        acc.totalDue += fee.remainingFee;
        if (fee.remainingFee <= 0) {
          acc.paid += 1;
        } else {
          acc.pending += 1;
        }
        return acc;
      },
      { totalStudents: 0, paid: 0, pending: 0, totalCollected: 0, totalDue: 0 }
    );

    return NextResponse.json({ fees, stats }, { status: 200 });
  } catch (error: any) {
    console.error("Fee summary error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

