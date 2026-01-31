import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { calculateFine } from "@/lib/library";

export async function GET() {
  const session = await getSession();

  if (!session || session.user.role !== "STUDENT") {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const books = await prisma.libraryIssue.findMany({
    where: {
      studentId: session.user.studentId!,
    },
    orderBy: { createdAt: "desc" },
  });

  const enrichedBooks = books.map((b) => {
    const { overdueDays, fineAmount } = calculateFine({
      expectedDate: b.expectedDate,
      finePerDay: b.finePerDay,
      returnDate: b.returnDate,
    });

    return {
      ...b,
      overdueDays,
      fineAmount,
      status:
        b.status === "ISSUED" && overdueDays > 0 ? "OVERDUE" : b.status,
    };
  });

  return NextResponse.json(enrichedBooks);
}
