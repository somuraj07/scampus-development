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

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { name, section, teacherId } = await req.json();

    if (!name) {
      return NextResponse.json(
        { message: "Class name is required" },
        { status: 400 }
      );
    }

    // Verify teacher belongs to the same school if teacherId is provided
    if (teacherId) {
      const teacher = await prisma.user.findFirst({
        where: {
          id: teacherId,
          schoolId: schoolId,
          role: "TEACHER",
        },
      });

      if (!teacher) {
        return NextResponse.json(
          { message: "Teacher not found or doesn't belong to your school" },
          { status: 400 }
        );
      }
    }

    const classData = await prisma.class.create({
      data: {
        name,
        section: section || null,
        schoolId,
        teacherId: teacherId || null,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true },
        },
        school: {
          select: { id: true, name: true },
        },
        _count: {
          select: { students: true },
        },
      },
    });

    return NextResponse.json(
      { message: "Class created successfully", class: classData },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Class creation error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}



