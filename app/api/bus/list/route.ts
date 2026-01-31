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

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      // Try to get school from admin relation (for admins)
      if (session.user.role === "SCHOOLADMIN" || session.user.role === "SUPERADMIN") {
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
      
      // For students, get schoolId from student profile
      if (!schoolId && session.user.role === "STUDENT" && session.user.studentId) {
        const student = await prisma.student.findUnique({
          where: { id: session.user.studentId },
          select: { schoolId: true },
        });
        schoolId = student?.schoolId ?? null;

        if (schoolId) {
          await prisma.user.update({
            where: { id: session.user.id },
            data: { schoolId },
          });
        }
      }
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found. Please contact your administrator." },
        { status: 400 }
      );
    }

    const cacheKey = `buses:${schoolId}`;
    const cachedBuses = await redis.get(cacheKey);
    if (cachedBuses) {
      console.log("✅ Buses served from Redis");
      return NextResponse.json({ buses: cachedBuses }, { status: 200 });
    }

    const buses = await prisma.bus.findMany({
      where: {
        schoolId: schoolId,
      },
      include: {
        routes: {
          orderBy: {
            location: "asc",
          },
        },
        bookings: {
          include: {
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
            route: {
              select: { id: true, location: true, amount: true },
            },
          },
        },
        _count: {
          select: { bookings: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Calculate available seats for each bus
    const busesWithAvailability = buses.map((bus) => {
      const bookedSeats = bus.bookings.map((b) => b.seatNumber);
      const availableSeats = Array.from({ length: bus.totalSeats }, (_, i) => i + 1).filter(
        (seat) => !bookedSeats.includes(seat)
      );

      return {
        ...bus,
        availableSeats,
        bookedSeatsCount: bus._count.bookings,
        availableSeatsCount: bus.totalSeats - bus._count.bookings,
      };
    });

    await redis.set(cacheKey, busesWithAvailability, { ex: 60 * 5 }); // Cache for 5 minutes

    return NextResponse.json({ buses: busesWithAvailability }, { status: 200 });
  } catch (error: any) {
    console.error("List buses error:", error);
    console.error("Error details:", {
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack,
    });
    return NextResponse.json(
      { 
        message: error?.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error?.stack : undefined,
        code: error?.code,
      },
      { status: 500 }
    );
  }
}
