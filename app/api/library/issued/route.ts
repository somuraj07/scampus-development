import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  if (!["SCHOOLADMIN", "TEACHER"].includes(session.user.role)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const issues = await prisma.libraryIssue.findMany({
    where: {
      schoolId: session.user.schoolId!,
    },
    include: {
      student: {
        include: {
          user: true,   // ✅ REQUIRED for student.user.name
          class: true,  // ✅ optional but useful for UI
        },
      },
      issuedBy: true, // faculty / librarian
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(issues);
}
