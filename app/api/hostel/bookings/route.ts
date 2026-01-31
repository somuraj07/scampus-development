import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Only school admins can view all bookings" },
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

    const cacheKey = `cot-bookings:${schoolId}`;
    const cachedBookings = await redis.get(cacheKey);
    if (cachedBookings) {
      console.log("✅ Hostel bookings served from Redis");
      return NextResponse.json({ bookings: cachedBookings }, { status: 200 });
    }

    const bookings = await prisma.cotBooking.findMany({
      where: {
        schoolId: schoolId,
      },
      include: {
        room: {
          include: {
            hostel: {
              select: {
                id: true,
                name: true,
                address: true,
                gender: true,
              },
            },
          },
        },
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true },
            },
            class: {
              select: { id: true, name: true, section: true },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    await redis.set(cacheKey, bookings, { ex: 60 * 5 }); // Cache for 5 minutes

    return NextResponse.json({ bookings }, { status: 200 });
  } catch (error: any) {
    console.error("List hostel bookings error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
