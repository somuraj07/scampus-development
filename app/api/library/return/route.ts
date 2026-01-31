import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calculateFine } from "@/lib/library";

export async function POST(req: Request) {
  const session = await getSession();

  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { issueId } = await req.json();

  const issue = await prisma.libraryIssue.findUnique({
    where: { id: issueId },
  });

  if (!issue) {
    return NextResponse.json({ message: "Issue not found" }, { status: 404 });
  }

  const { overdueDays, fineAmount } = calculateFine({
    expectedDate: issue.expectedDate,
    finePerDay: issue.finePerDay,
  });

  const updated = await prisma.libraryIssue.update({
    where: { id: issueId },
    data: {
      returnDate: new Date(),
      overdueDays,
      fineAmount,
      status: "RETURNED",
    },
  });

  return NextResponse.json(updated);
}

