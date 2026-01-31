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

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }
  const cachedKey = `newsFeeds:${schoolId}`;
    const cachedNewsFeeds = await redis.get(cachedKey);
    if (cachedNewsFeeds) {
      console.log("✅ News feeds served from Redis");
      return NextResponse.json({ newsFeeds: cachedNewsFeeds }, { status: 200 });
    }
    // For students: show all news feeds from their school
    // For teachers/admins: show all news feeds from their school
    const newsFeeds = await prisma.newsFeed.findMany({
      where: {
        schoolId: schoolId,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });
    await redis.set(cachedKey,newsFeeds,{ex:60 * 5}); // Cache for 5 minutes

    return NextResponse.json({ newsFeeds }, { status: 200 });
  } catch (error: any) {
    console.error("List news feeds error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
