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

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student record not found" },
        { status: 400 }
      );
    }

    const { homeworkId, content, fileUrl } = await req.json();

    if (!homeworkId) {
      return NextResponse.json(
        { message: "Homework ID is required" },
        { status: 400 }
      );
    }

    if (!session.user.studentId) {
      return NextResponse.json(
        { message: "Student record not found" },
        { status: 400 }
      );
    }

    // Verify homework exists and student is in the class
    const homework = await prisma.homework.findUnique({
      where: { id: homeworkId },
      include: {
        class: true,
      },
    });

    if (!homework) {
      return NextResponse.json(
        { message: "Homework not found" },
        { status: 404 }
      );
    }

    const student = await prisma.student.findUnique({
      where: { id: session.user.studentId },
      select: { classId: true },
    });

    if (!student || student.classId !== homework.classId) {
      return NextResponse.json(
        { message: "You are not assigned to this homework's class" },
        { status: 403 }
      );
    }

    // Check if already submitted
    const existingSubmission = await prisma.homeworkSubmission.findUnique({
      where: {
        homeworkId_studentId: {
          homeworkId,
          studentId: session.user.studentId,
        },
      },
    });

    if (existingSubmission) {
      // Update existing submission
      const updated = await prisma.homeworkSubmission.update({
        where: { id: existingSubmission.id },
        data: {
          content: content || null,
          fileUrl: fileUrl || null,
          submittedAt: new Date(),
        },
      });

      return NextResponse.json(
        { message: "Homework submission updated successfully", submission: updated },
        { status: 200 }
      );
    }

    // Create new submission
    const submission = await prisma.homeworkSubmission.create({
      data: {
        homeworkId,
        studentId: session.user.studentId,
        content: content || null,
        fileUrl: fileUrl || null,
      },
    });

    return NextResponse.json(
      { message: "Homework submitted successfully", submission },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Submit homework error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
