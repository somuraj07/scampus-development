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

    // Only SCHOOLADMIN can create buses
    if (session.user.role !== "PRINCIPAL" && session.user.role !== "SCHOOLADMIN") { 
      return NextResponse.json(
        { message: "Only school admins can create buses" },
        { status: 403 }
      );
    }

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { busNumber, driverName, driverNumber, totalSeats, time, routes } =
      await req.json();

    // Validation
    if (!busNumber || !driverName || !driverNumber || !totalSeats || !time) {
      return NextResponse.json(
        { message: "Bus number, driver name, driver number, total seats, and time are required" },
        { status: 400 }
      );
    }

    if (!routes || !Array.isArray(routes) || routes.length === 0) {
      return NextResponse.json(
        { message: "At least one route with location and amount is required" },
        { status: 400 }
      );
    }

    if (totalSeats <= 0) {
      return NextResponse.json(
        { message: "Total seats must be greater than 0" },
        { status: 400 }
      );
    }

    // Validate routes
    for (const route of routes) {
      if (!route.location || route.amount === undefined || route.amount < 0) {
        return NextResponse.json(
          { message: "Each route must have a location and a non-negative amount" },
          { status: 400 }
        );
      }
    }

    // Check if bus number already exists for this school
    const existingBus = await prisma.bus.findFirst({
      where: {
        busNumber,
        schoolId,
      },
    });

    if (existingBus) {
      return NextResponse.json(
        { message: "Bus with this number already exists" },
        { status: 400 }
      );
    }

    // Create bus with routes in a transaction
    const bus = await prisma.$transaction(
      async (tx) => {
      const newBus = await tx.bus.create({
        data: {
          busNumber,
          driverName,
          driverNumber,
          totalSeats: parseInt(totalSeats),
          time,
          schoolId,
        },
      });

      // Create routes for this bus
      const createdRoutes = await Promise.all(
        routes.map((route: { location: string; amount: number }) =>
          tx.busRoute.create({
            data: {
              location: route.location.trim(),
              amount: typeof route.amount === "string" ? parseFloat(route.amount) : route.amount,
              busId: newBus.id,
            },
          })
        )
      );

      return {
        ...newBus,
        routes: createdRoutes,
      };
    },
      {
        maxWait: 10000, // Maximum time to wait for a transaction slot (10 seconds)
        timeout: 20000, // Maximum time the transaction can run (20 seconds)
      }
    );

    // Invalidate cache
    await redis.del(`buses:${schoolId}`);
    await redis.del(`bus-bookings:${schoolId}`);

    return NextResponse.json(
      { message: "Bus created successfully", bus },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Bus creation error:", error);
    
    // Handle transaction timeout errors
    if (error?.code === "P1008" || error?.message?.includes("transaction") || error?.message?.includes("timeout")) {
      return NextResponse.json(
        { message: "Transaction timeout. Please try again." },
        { status: 408 }
      );
    }
    
    // Handle Prisma unique constraint errors
    if (error?.code === "P2002") {
      const field = error?.meta?.target?.[0] || "field";
      return NextResponse.json(
        { message: `${field} already exists` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}