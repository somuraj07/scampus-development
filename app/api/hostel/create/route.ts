import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "PRINCIPAL" && session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Only school admins can create hostels" },
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

    const { name, address, gender, rooms } = await req.json();

    if (!name || !address || !gender) {
      return NextResponse.json(
        { message: "Hostel name, address, and gender are required" },
        { status: 400 }
      );
    }

    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return NextResponse.json(
        { message: "At least one room is required" },
        { status: 400 }
      );
    }

    // Validate rooms
    for (const room of rooms) {
      if (!room.roomNumber || !room.cotCount || room.amount === undefined || room.amount < 0) {
        return NextResponse.json(
          { message: "Each room must have room number, cot count, and a non-negative amount" },
          { status: 400 }
        );
      }
      if (room.floor === undefined || room.floor < 0) {
        return NextResponse.json(
          { message: "Each room must have a valid floor number" },
          { status: 400 }
        );
      }
    }

    // Create hostel with rooms in a transaction
    const hostel = await prisma.$transaction(
      async (tx) => {
        const newHostel = await tx.hostel.create({
          data: {
            name: name.trim(),
            address: address.trim(),
            gender: gender.toUpperCase(),
            schoolId,
          },
        });

        // Create rooms for this hostel
        const createdRooms = await Promise.all(
          rooms.map((room: { roomNumber: string; floor: number | string; cotCount: number | string; amount: number | string }) =>
            tx.room.create({
              data: {
                roomNumber: room.roomNumber.trim(),
                floor: typeof room.floor === "string" ? parseInt(room.floor) : room.floor,
                cotCount: typeof room.cotCount === "string" ? parseInt(room.cotCount) : room.cotCount,
                amount: typeof room.amount === "string" ? parseFloat(room.amount) : room.amount,
                hostelId: newHostel.id,
              },
            })
          )
        );

        return {
          ...newHostel,
          rooms: createdRooms,
        };
      },
      {
        maxWait: 10000, // Maximum time to wait for a transaction slot (10 seconds)
        timeout: 20000, // Maximum time the transaction can run (20 seconds)
      }
    );

    // Invalidate cache
    await redis.del(`hostels:${schoolId}`);
    await redis.del(`cot-bookings:${schoolId}`);

    return NextResponse.json(
      { message: "Hostel created successfully", hostel },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Hostel creation error:", error);
    console.error("Error stack:", error?.stack);
    console.error("Error details:", {
      code: error?.code,
      message: error?.message,
      meta: error?.meta,
    });
    
    // Handle transaction timeout errors
    if (error?.code === "P1008" || error?.message?.includes("transaction") || error?.message?.includes("timeout")) {
      return NextResponse.json(
        { message: "Transaction timeout. Please try again." },
        { status: 408 }
      );
    }
    
    if (error?.code === "P2002") {
      const field = error?.meta?.target?.[0] || "field";
      return NextResponse.json(
        { message: `${field} already exists` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { 
        message: error?.message || "Internal server error",
        error: process.env.NODE_ENV === "development" ? error?.stack : undefined,
      },
      { status: 500 }
    );
  }
}
