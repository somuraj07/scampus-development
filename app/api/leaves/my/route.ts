import { authOptions } from "@/lib/authOptions"
import prisma from "@/lib/db"
import { getServerSession } from "next-auth"

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        teacherId: session.user.id
      },
      orderBy: { createdAt: "desc" }
    })

    return Response.json(leaves)
  } catch {
    return Response.json({ error: "Internal error" }, { status: 500 })
  }
}
