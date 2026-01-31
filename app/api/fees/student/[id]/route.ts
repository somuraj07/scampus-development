import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

type RouteParams =
  | { params: { id: string } }
  | { params: Promise<{ id: string }> };

export async function GET(_req: Request, context: RouteParams) {
  const resolved = "then" in context.params ? await context.params : context.params;
  const id = resolved.id;

  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const fee = await prisma.studentFee.findUnique({
      where: { studentId: id },
    });

    if (!fee) {
      return NextResponse.json(
        { message: "Fee details not found for this student" },
        { status: 404 }
      );
    }

    return NextResponse.json({ fee });
  } catch (error: any) {
    console.error("Get fee by student error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request, context: RouteParams) {
  const resolved = "then" in context.params ? await context.params : context.params;
  const id = resolved.id;

  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (session.user.role !== "SCHOOLADMIN" && session.user.role !== "SUPERADMIN") {
    return NextResponse.json(
      { message: "Only admins can update student fees" },
      { status: 403 }
    );
  }

  try {
    const existing = await prisma.studentFee.findUnique({
      where: { studentId: id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: "Fee details not found for this student" },
        { status: 404 }
      );
    }

    const body = await req.json();
    const { totalFee, discountPercent, installments } = body;

    let newTotalFee = typeof totalFee === "number" ? totalFee : existing.totalFee;
    let newDiscount =
      typeof discountPercent === "number" ? discountPercent : existing.discountPercent;

    if (newTotalFee <= 0) {
      return NextResponse.json(
        { message: "totalFee must be a positive number" },
        { status: 400 }
      );
    }

    if (newDiscount < 0 || newDiscount > 100) {
      return NextResponse.json(
        { message: "discountPercent must be between 0 and 100" },
        { status: 400 }
      );
    }

    const finalFee = newTotalFee * (1 - newDiscount / 100);
    const remainingFee = Math.max(finalFee - existing.amountPaid, 0);

    const updated = await prisma.studentFee.update({
      where: { studentId: id },
      data: {
        totalFee: newTotalFee,
        discountPercent: newDiscount,
        finalFee,
        remainingFee,
        installments:
          typeof installments === "number" && installments > 0
            ? installments
            : existing.installments,
      },
    });

    return NextResponse.json({ fee: updated });
  } catch (error: any) {
    console.error("Update student fee error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

