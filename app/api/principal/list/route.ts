import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";
import { Role } from "@/app/generated/prisma";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    let schoolId = session.user.schoolId;

    // 🔁 Resolve schoolId if missing
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

    const cacheKey = `principal:${schoolId}`;
    const cachedPrincipal = await redis.get(cacheKey);

    if (cachedPrincipal) {
      console.log("✅ Principal served from Redis");
      return NextResponse.json(
        { principal: cachedPrincipal },
        { status: 200 }
      );
    }

    // 🔍 Find principal
    const principal = await prisma.user.findFirst({
      where: {
        schoolId,
        role: Role.PRINCIPAL,
      },
      select: {
        id: true,
        name: true,
        email: true,
        mobile: true,
        role: true,
      },
    });

    if (!principal) {
      return NextResponse.json(
        { principal: null, message: "Principal not created yet" },
        { status: 200 }
      );
    }

    await redis.set(cacheKey, principal, { ex: 60 * 5 }); // 5 mins cache

    return NextResponse.json({ principal }, { status: 200 });
  } catch (error: any) {
    console.error("Get principal error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
export async function PUT(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { name } = await req.json();

    if (!name || name.trim().length < 3) {
      return NextResponse.json(
        { message: "Valid name is required" },
        { status: 400 }
      );
    }

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found" },
        { status: 400 }
      );
    }

    const principal = await prisma.user.findFirst({
      where: {
        schoolId,
        role: Role.PRINCIPAL,
      },
    });

    if (!principal) {
      return NextResponse.json(
        { message: "Principal not found" },
        { status: 404 }
      );
    }

    const updatedPrincipal = await prisma.user.update({
      where: { id: principal.id },
      data: { name },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        mobile: true,
      },
    });

    // 🔄 Clear cache
    await redis.del(`principal:${schoolId}`);

    return NextResponse.json(
      { message: "Principal updated successfully", principal: updatedPrincipal },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Update principal error:", error);
    return NextResponse.json(
      { message: "Internal server error" },
      { status: 500 }
    );
  }
}
