// lib/library.ts
export function calculateFine({
  expectedDate,
  finePerDay,
  returnDate,
}: {
  expectedDate: Date;
  finePerDay: number;
  returnDate?: Date | null;
}) {
  const today = returnDate ?? new Date();

  const diffTime = today.getTime() - expectedDate.getTime();

  if (diffTime <= 0) {
    return { overdueDays: 0, fineAmount: 0 };
  }

  const overdueDays = Math.floor(
    diffTime / (1000 * 60 * 60 * 24)
  );

  const fineAmount = overdueDays * finePerDay;

  return { overdueDays, fineAmount };
}
