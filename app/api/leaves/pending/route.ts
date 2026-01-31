import { authOptions } from "@/lib/authOptions"
import prisma from "@/lib/db"
import { redis } from "@/lib/redis"
import { getServerSession } from "next-auth"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }       
  const cachedKey = `leaves:pending:${session.user.schoolId}`;
  const cachedLeaves = await redis.get(cachedKey);
  if (cachedLeaves) {
    console.log("✅ Pending leaves served from Redis");
    return Response.json(cachedLeaves, { status: 200 });
  }
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        schoolId: session.user.schoolId as string,
        status: "PENDING"
      },
      include: {
        teacher: {
          select: {
            id: true,
            name: true,
            email: true,
            mobile: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    })
   await redis.set(cachedKey,leaves,{ex:60 * 5}); // Cache for 5 minutes
    return Response.json(leaves)
  } catch {
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
