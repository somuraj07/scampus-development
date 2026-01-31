import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await getSession();

  if (!session)
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  if (!["SCHOOLADMIN", "TEACHER"].includes(session.user.role))
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });

  const {
    bookName,
    bookNumber,
    studentId,
    expectedDate,
    finePerDay,
  } = await req.json();

  if (!bookName || !studentId || !expectedDate) {
    return NextResponse.json(
      { message: "Missing required fields" },
      { status: 400 }
    );
  }

  // 1️⃣ Create issue
  const created = await prisma.libraryIssue.create({
    data: {
      bookName,
      bookNumber: bookNumber ?? null,
      studentId,
      expectedDate: new Date(expectedDate),
      finePerDay: Number(finePerDay) || 0,
      issuedById: session.user.id,
      schoolId: session.user.schoolId!,
    },
  });

  // 2️⃣ Re-fetch with relations (IMPORTANT)
  const issue = await prisma.libraryIssue.findUnique({
    where: { id: created.id },
    include: {
      student: {
        include: {
          user: true,
          class: true,
        },
      },
      issuedBy: true,
    },
  });

  return NextResponse.json(issue, { status: 201 });
}
