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

    const { templateId, studentId, title, description, certificateUrl } = await req.json();

    if (!templateId || !studentId || !title) {
      return NextResponse.json(
        { message: "Template ID, student ID, and title are required" },
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

    // Verify template belongs to school
    const template = await prisma.certificateTemplate.findFirst({
      where: {
        id: templateId,
        schoolId: schoolId,
      },
    });

    if (!template) {
      return NextResponse.json(
        { message: "Certificate template not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    // Verify student belongs to school
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        schoolId: schoolId,
      },
    });

    if (!student) {
      return NextResponse.json(
        { message: "Student not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    const certificate = await prisma.certificate.create({
      data: {
        title,
        description: description || null,
        templateId,
        studentId,
        issuedById: session.user.id,
        schoolId,
        certificateUrl: certificateUrl || null,
      },
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        template: {
          select: { id: true, name: true },
        },
        issuedBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      { message: "Certificate assigned successfully", certificate },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Assign certificate error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
