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
      // Try to get school from admin relation
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
   const cachedKey = `teachers:${schoolId}`;
   const cachedTeachers = await redis.get(cachedKey);
    if (cachedTeachers) {
      console.log("✅ Teachers served from Redis");
      return NextResponse.json({ teachers: cachedTeachers }, { status: 200 });
    }
    const teachers = await prisma.user.findMany({
      where: {
        schoolId: schoolId,
        role: "TEACHER",
      },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
      },
      orderBy: {
        name: "asc",
      },
    });
    await redis.set(cachedKey,teachers,{ex:60 * 5}); // Cache for 5 minutes
    return NextResponse.json({ teachers }, { status: 200 });
  } catch (error: any) {
    console.error("List teachers error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
