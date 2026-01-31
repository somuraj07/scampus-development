import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { tcDocumentUrl } = await req.json();

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify TC belongs to school
    const tc = await prisma.transferCertificate.findFirst({
      where: {
        id: id,
        schoolId: schoolId,
      },
      include: {
        student: true,
      },
    });

    if (!tc) {
      return NextResponse.json(
        { message: "TC not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    if (tc.status !== "PENDING") {
      return NextResponse.json(
        { message: `TC is already ${tc.status}` },
        { status: 400 }
      );
    }

    // Use transaction to approve TC and deactivate student
    const result = await prisma.$transaction(async (tx) => {
      // Update TC status
      const updatedTC = await tx.transferCertificate.update({
        where: { id: id },
        data: {
          status: "APPROVED",
          approvedById: session.user.id,
          issuedDate: new Date(),
          tcDocumentUrl: tcDocumentUrl || null,
        },
      });

      // Save student data to history
      const studentData = {
        id: tc.student.id,
        userId: tc.student.userId,
        schoolId: tc.student.schoolId,
        classId: tc.student.classId,
        fatherName: tc.student.fatherName,
        aadhaarNo: tc.student.aadhaarNo,
        phoneNo: tc.student.phoneNo,
        rollNo: tc.student.rollNo,
        dob: tc.student.dob,
        address: tc.student.address,
        createdAt: tc.student.createdAt,
      };

      await tx.studentHistory.create({
        data: {
          originalStudentId: tc.student.id,
          schoolId: schoolId,
          studentData: studentData as any,
          deactivatedBy: session.user.id,
          reason: `Transfer Certificate approved - ${tc.reason || "No reason provided"}`,
        },
      });

      // Deactivate user account (set password to null to prevent login)
      await tx.user.update({
        where: { id: tc.student.userId },
        data: {
          password: null, // This will prevent login
        },
      });

      // Remove student from class
      await tx.student.update({
        where: { id: tc.student.id },
        data: {
          classId: null,
        },
      });

      // Note: We don't delete the student record to maintain referential integrity
      // The account is deactivated by removing password

      return updatedTC;
    });

    return NextResponse.json(
      {
        message: "TC approved and student account deactivated successfully",
        tc: result,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Approve TC error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
