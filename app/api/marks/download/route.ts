import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function GET(req: Request) {
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

    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") || "json"; // json or pdf

    const marks = await prisma.mark.findMany({
      where: {
        studentId: session.user.studentId,
      },
      include: {
        class: {
          select: { id: true, name: true, section: true },
        },
        teacher: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const student = await prisma.student.findUnique({
      where: { id: session.user.studentId },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        class: {
          select: { id: true, name: true, section: true },
        },
      },
    });

    if (format === "pdf") {
      // For PDF generation, return data that can be used by frontend to generate PDF
      // You can integrate libraries like jsPDF or pdfkit on the frontend
      return NextResponse.json({
        student,
        marks,
        format: "pdf",
        message: "Use this data to generate PDF on frontend",
      });
    }

    // Return JSON format
    return NextResponse.json(
      {
        student: {
          name: student?.user.name,
          email: student?.user.email,
          class: student?.class?.name,
          section: student?.class?.section,
        },
        marks: marks.map((m) => ({
          subject: m.subject,
          marks: m.marks,
          totalMarks: m.totalMarks,
          grade: m.grade,
          percentage: ((m.marks / m.totalMarks) * 100).toFixed(2),
          suggestions: m.suggestions,
          teacher: m.teacher.name,
          date: m.createdAt,
        })),
        generatedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="marks-report-${Date.now()}.json"`,
        },
      }
    );
  } catch (error: any) {
    console.error("Download marks error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
