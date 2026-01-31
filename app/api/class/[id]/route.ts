import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const schoolId = session.user.schoolId;
    const classId = id;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const classData = await prisma.class.findFirst({
      where: {
        id: classId,
        schoolId: schoolId,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true },
        },
        students: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
          },
        },
        school: {
          select: { id: true, name: true },
        },
      },
    });

    if (!classData) {
      return NextResponse.json(
        { message: "Class not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ class: classData }, { status: 200 });
  } catch (error: any) {
    console.error("Get class error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
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
    const schoolId = session.user.schoolId;
    const classId = id;
    const { name, section, teacherId } = await req.json();

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify class belongs to the school
    const existingClass = await prisma.class.findFirst({
      where: {
        id: classId,
        schoolId: schoolId,
      },
    });

    if (!existingClass) {
      return NextResponse.json(
        { message: "Class not found" },
        { status: 404 }
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

    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: {
        name: name || existingClass.name,
        section: section !== undefined ? section : existingClass.section,
        teacherId: teacherId !== undefined ? teacherId : existingClass.teacherId,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true },
        },
        _count: {
          select: { students: true },
        },
      },
    });

    return NextResponse.json(
      { message: "Class updated successfully", class: updatedClass },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Update class error:", error);
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
    const schoolId = session.user.schoolId;
    const classId = id;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify class belongs to the school
    const existingClass = await prisma.class.findFirst({
      where: {
        id: classId,
        schoolId: schoolId,
      },
      include: {
        _count: {
          select: { students: true },
        },
      },
    });

    if (!existingClass) {
      return NextResponse.json(
        { message: "Class not found" },
        { status: 404 }
      );
    }

    // Check if class has students
    if (existingClass._count.students > 0) {
      return NextResponse.json(
        {
          message:
            "Cannot delete class with students. Please reassign or remove students first.",
        },
        { status: 400 }
      );
    }

    await prisma.class.delete({
      where: { id: classId },
    });

    return NextResponse.json(
      { message: "Class deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Delete class error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
