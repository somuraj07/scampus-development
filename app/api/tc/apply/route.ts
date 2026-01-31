import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { reason } = await req.json();

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student record not found" },
        { status: 400 }
      );
    }

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Check if TC already exists
    const existingTC = await prisma.transferCertificate.findFirst({
      where: {
        studentId: session.user.studentId,
        status: {
          in: ["PENDING", "APPROVED"],
        },
      },
    });

    if (existingTC) {
      return NextResponse.json(
        { message: "You already have a pending or approved TC request" },
        { status: 400 }
      );
    }

    const tc = await prisma.transferCertificate.create({
      data: {
        reason: reason || null,
        studentId: session.user.studentId,
        requestedById: session.user.id,
        schoolId,
        status: "PENDING",
      },
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
      },
    });

    return NextResponse.json(
      { message: "TC request submitted successfully", tc },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Apply TC error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
