import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { getServerSession } from "next-auth";

interface Params {
  id: string;
}

export async function PATCH(req: Request, { params }: { params: Params | Promise<Params> }) {
  try {
    const { id } = await params; // <-- unwrap the promise if needed

    const session = await getServerSession(authOptions);
    if (!session?.user?.id) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    if (!id) {
      return new Response(JSON.stringify({ error: "Leave ID is required" }), { status: 400 });
    }

    const leave = await prisma.leaveRequest.update({
      where: { id },
      data: {
        status: "APPROVED",
        approverId: session.user.id
      }
    });

    return new Response(JSON.stringify(leave), { status: 200 });

  } catch (err: any) {
    console.error("Approve leave failed:", err);
    return new Response(JSON.stringify({ error: err.message || "Unable to approve leave" }), { status: 500 });
  }
}
