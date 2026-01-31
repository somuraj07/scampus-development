import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

function calculateGrade(marks: number, totalMarks: number): string {
  const percentage = (marks / totalMarks) * 100;
  
  if (percentage >= 90) return "A+";
  if (percentage >= 80) return "A";
  if (percentage >= 70) return "B+";
  if (percentage >= 60) return "B";
  if (percentage >= 50) return "C";
  if (percentage >= 40) return "D";
  return "F";
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const markId = id;
    const { subject, marks, totalMarks, suggestions } = await req.json();

    const existingMark = await prisma.mark.findUnique({
      where: { id: markId },
      include: {
        teacher: true,
        class: true,
      },
    });

    if (!existingMark) {
      return NextResponse.json(
        { message: "Mark record not found" },
        { status: 404 }
      );
    }

    // Verify teacher owns this mark
    if (existingMark.teacherId !== session.user.id) {
      return NextResponse.json(
        { message: "You can only update your own marks" },
        { status: 403 }
      );
    }

    if (marks !== undefined && totalMarks !== undefined) {
      if (marks < 0 || totalMarks <= 0 || marks > totalMarks) {
        return NextResponse.json(
          { message: "Invalid marks: marks must be between 0 and totalMarks" },
          { status: 400 }
        );
      }
    }

    const updateData: any = {};
    if (subject !== undefined) updateData.subject = subject;
    if (marks !== undefined) updateData.marks = marks;
    if (totalMarks !== undefined) updateData.totalMarks = totalMarks;
    if (suggestions !== undefined) updateData.suggestions = suggestions;

    // Recalculate grade if marks changed
    if (marks !== undefined || totalMarks !== undefined) {
      const finalMarks = marks !== undefined ? marks : existingMark.marks;
      const finalTotal = totalMarks !== undefined ? totalMarks : existingMark.totalMarks;
      updateData.grade = calculateGrade(finalMarks, finalTotal);
    }

    const updatedMark = await prisma.mark.update({
      where: { id: markId },
      data: updateData,
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        class: {
          select: { id: true, name: true, section: true },
        },
        teacher: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      { message: "Marks updated successfully", mark: updatedMark },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Update marks error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const markId = id;

    const existingMark = await prisma.mark.findUnique({
      where: { id: markId },
    });

    if (!existingMark) {
      return NextResponse.json(
        { message: "Mark record not found" },
        { status: 404 }
      );
    }

    // Verify teacher owns this mark
    if (existingMark.teacherId !== session.user.id) {
      return NextResponse.json(
        { message: "You can only delete your own marks" },
        { status: 403 }
      );
    }

    await prisma.mark.delete({
      where: { id: markId },
    });

    return NextResponse.json(
      { message: "Mark deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Delete marks error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
