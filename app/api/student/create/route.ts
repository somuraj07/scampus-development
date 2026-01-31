import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";
import { Role } from "@/app/generated/prisma";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    let schoolId = session.user.schoolId;

    // Fallback: find school where the admin belongs
    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;

      if (schoolId) {
        // persist the school on the user for future requests
        await prisma.user.update({
          where: { id: session.user.id },
          data: { schoolId },
        });
      }
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const {
      name,
      email,
      fatherName,
      aadhaarNo,
      phoneNo,
      dob,
      classId,
      address,
      totalFee,
      discountPercent,
    } = await req.json();

    // Validate all required fields
    if (!name || !dob || !fatherName || !aadhaarNo || !phoneNo) {
      return NextResponse.json(
        { message: "Missing required fields: name, dob, fatherName, aadhaarNo, and phoneNo are required" },
        { status: 400 }
      );
    }

    if (typeof totalFee !== "number" || totalFee <= 0) {
      return NextResponse.json(
        { message: "totalFee must be a positive number" },
        { status: 400 }
      );
    }

    const safeDiscount = typeof discountPercent === "number" ? discountPercent : 0;
    if (safeDiscount < 0 || safeDiscount > 100) {
      return NextResponse.json(
        { message: "discountPercent must be between 0 and 100" },
        { status: 400 }
      );
    }

    // DOB as default password YYYYMMDD
    const dobDate = new Date(dob);
    const password = dobDate.toISOString().split("T")[0].replace(/-/g, "");
    const hashedPassword = await bcrypt.hash(password, 10);

    // Use transaction with timeout (10 seconds) and isolation level
    const student = await prisma.$transaction(
      async (tx) => {
        const user = await tx.user.create({
          data: {
            name,
            email,
            password: hashedPassword,
            role: Role.STUDENT,
            schoolId,
          },
        });

        const student = await tx.student.create({
          data: {
            userId: user.id,
            schoolId,
            classId: classId ?? null,
            dob: dobDate,
            address,
            fatherName,
            aadhaarNo,
            phoneNo,
          },
          include: {
            user: { select: { id: true, name: true, email: true } },
            class: true,
          },
        });

        const finalFee = totalFee * (1 - safeDiscount / 100);

        await tx.studentFee.create({
          data: {
            studentId: student.id,
            totalFee,
            discountPercent: safeDiscount,
            finalFee,
            amountPaid: 0,
            remainingFee: finalFee,
            installments: 3,
          },
        });

        return student;
      },
      {
        maxWait: 10000, // Maximum time to wait for a transaction slot (10 seconds)
        timeout: 20000, // Maximum time the transaction can run (20 seconds)
      }
    );

    return NextResponse.json(
      { message: "Student created under your school", student },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Student creation error:", error);
    
    // Handle transaction timeout errors
    if (error?.code === "P1008" || error?.message?.includes("transaction") || error?.message?.includes("timeout")) {
      return NextResponse.json(
        { message: "Transaction timeout. Please try again." },
        { status: 408 }
      );
    }
    
    // Handle Prisma unique constraint violations
    if (error?.code === "P2002") {
      const field = error?.meta?.target?.[0];
      if (field === "email") {
        return NextResponse.json(
          { message: "Email already exists" },
          { status: 400 }
        );
      }
      if (field === "aadhaarNo") {
        return NextResponse.json(
          { message: "Aadhaar number already exists" },
          { status: 400 }
        );
      }
    }
    
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
