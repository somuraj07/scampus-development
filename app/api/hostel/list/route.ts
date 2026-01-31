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
        { message: "School not found" },
        { status: 400 }
      );
    }

    const cacheKey = `hostels:${schoolId}`;
    const cachedHostels = await redis.get(cacheKey);
    if (cachedHostels) {
      console.log("✅ Hostels served from Redis");
      return NextResponse.json({ hostels: cachedHostels }, { status: 200 });
    }

    const hostels = await prisma.hostel.findMany({
      where: {
        schoolId: schoolId,
      },
      include: {
        rooms: {
          include: {
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
              },
            },
            _count: {
              select: { bookings: true },
            },
          },
          orderBy: [
            { floor: "asc" },
            { roomNumber: "asc" },
          ],
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Calculate available cots for each room
    const hostelsWithAvailability = hostels.map((hostel) => ({
      ...hostel,
      rooms: hostel.rooms.map((room) => {
        const bookedCots = room.bookings.map((b) => b.cotNumber);
        const availableCots = Array.from({ length: room.cotCount }, (_, i) => i + 1).filter(
          (cot) => !bookedCots.includes(cot)
        );

        return {
          ...room,
          availableCots,
          bookedCotsCount: room._count.bookings,
          availableCotsCount: room.cotCount - room._count.bookings,
        };
      }),
    }));

    await redis.set(cacheKey, hostelsWithAvailability, { ex: 60 * 5 }); // Cache for 5 minutes

    return NextResponse.json({ hostels: hostelsWithAvailability }, { status: 200 });
  } catch (error: any) {
    console.error("List hostels error:", error);
    return NextResponse.json(
      {
        message: error?.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}
