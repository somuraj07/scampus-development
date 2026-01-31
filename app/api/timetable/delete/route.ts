import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function DELETE(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Only school admins can delete timetable entries" },
        { status: 403 }
      );
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { searchParams } = new URL(req.url);
    const timetableId = searchParams.get("id");

    if (!timetableId) {
      return NextResponse.json(
        { message: "Timetable ID is required" },
        { status: 400 }
      );
    }

    // Check if timetable exists and belongs to the school
    const timetable = await prisma.timetable.findFirst({
      where: {
        id: timetableId,
        class: {
          schoolId: schoolId,
        },
      },
    });

    if (!timetable) {
      return NextResponse.json(
        { message: "Timetable entry not found" },
        { status: 404 }
      );
    }

    await prisma.timetable.delete({
      where: { id: timetableId },
    });

    // Invalidate cache
    await redis.del(`timetable:${timetable.classId}`);

    return NextResponse.json(
      { message: "Timetable entry deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Timetable deletion error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
