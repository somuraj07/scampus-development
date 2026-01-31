import { authOptions } from "@/lib/authOptions"
import prisma from "@/lib/db"
import { getServerSession } from "next-auth"

export async function POST(req: Request) {
  try {
    // ✅ Get logged-in user
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const user = session.user

    const { leaveType, reason, fromDate, toDate } = await req.json()

    if (!leaveType || !fromDate || !toDate) {
      return Response.json(
        { error: "Missing required fields" },
        { status: 400 }
      )
    }

    // ✅ Prevent overlapping leaves
    const overlap = await prisma.leaveRequest.findFirst({
      where: {
        teacherId: user.id,
        status: { not: "REJECTED" },
        fromDate: { lte: new Date(toDate) },
        toDate: { gte: new Date(fromDate) }
      }
    })

    if (overlap) {
      return Response.json(
        { error: "Leave already exists for this period" },
        { status: 409 }
      )
    }

    // ✅ Create leave request
    const leave = await prisma.leaveRequest.create({
      data: {
        teacherId: user.id,
        schoolId: user.schoolId as string,
        leaveType,
        reason,
        fromDate: new Date(fromDate),
        toDate: new Date(toDate)
      }
    })

    return Response.json(leave, { status: 201 })
  } catch (e: any) {
    return Response.json(
      { error: e.message || "Internal Server Error" },
      { status: 500 }
    )
  }
}
