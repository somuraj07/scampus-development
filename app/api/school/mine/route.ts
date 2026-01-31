import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { redis } from "@/lib/redis";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json(
      { message: "Unauthorized", school: null },
      { status: 401 }
    );
  }

  const schoolId = session.user.schoolId;

  if (!schoolId) {
    return NextResponse.json({ school: null }, { status: 200 });
  }
  const cachedKey = `school:${schoolId}`;
  const cachedSchool = await redis.get(cachedKey);
  if (cachedSchool) {
    console.log("✅ School details served from Redis");
    return NextResponse.json({ school: cachedSchool }, { status: 200 });
  }
  // ✅ READ from replica
  const school = await prisma.school.findUnique({
    where: { id: schoolId },
  });
  await redis.set(cachedKey,school,{ex:60 * 5}); // Cache for 5 minutes

  return NextResponse.json({ school }, { status: 200 });
}
