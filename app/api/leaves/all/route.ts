import prisma from "@/lib/db";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { redis } from "@/lib/redis";

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user?.schoolId) {
  return new Response(JSON.stringify({ error: "Unauthorized: No school assigned" }), { status: 401 });
}
const cachedKey = `leaves:${session.user.schoolId}`;
const cachedLeaves = await redis.get(cachedKey);
if (cachedLeaves) {
  console.log("✅ Leaves served from Redis");
  return new Response(JSON.stringify(cachedLeaves), { status: 200 });
}
const leaves = await prisma.leaveRequest.findMany({
  where: { schoolId: session.user.schoolId },
  include: {
    teacher: { select: { id: true, name: true, email: true } },
    approver: { select: { id: true, name: true, email: true } },
  },
  orderBy: { createdAt: "desc" },
});
await redis.set(cachedKey,leaves,{ex:60 * 5}); // Cache for 5 minutes

    return new Response(JSON.stringify(leaves), { status: 200 });
  } catch (err: any) {
    console.error("Fetch all leaves error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
}
