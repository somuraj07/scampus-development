import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;

      if (schoolId) {
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
   const cachedKey = `students:${schoolId}`;
    const cachedStudents = await redis.get(cachedKey);
    if (cachedStudents) {
      console.log("✅ Students served from Redis");
      return NextResponse.json({ students: cachedStudents }, { status: 200 });
    }
    const students = await prisma.student.findMany({
      where: {
        schoolId: schoolId,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
        class: {
          select: { id: true, name: true, section: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
   await redis.set(cachedKey,students,{ex:60 * 5}); // Cache for 5 minutes
    return NextResponse.json({ students }, { status: 200 });
  } catch (error: any) {
    console.error("List students error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
