import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import bcrypt from "bcryptjs";
import { Role } from "@/app/generated/prisma";
import * as XLSX from "xlsx";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });

      schoolId = adminSchool?.id ?? null;

      if (schoolId) {
        await prisma.user.update({
          where: { id: session.user.id },
          data: { schoolId },
        });
      }
    }

    if (!schoolId) {
      return NextResponse.json({ message: "School not found" }, { status: 400 });
    }

    /* ================= EXCEL ================= */

    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ message: "Excel file required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    if (!rows.length) {
      return NextResponse.json({ message: "Excel empty" }, { status: 400 });
    }

    const created: any[] = [];
    const failed: any[] = [];

    /* ================= SINGLE TRANSACTION ================= */

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];

        try {
          const name = String(row.name || "").trim();
          const email = row.email ? String(row.email).trim() : null;
          const fatherName = String(row.fatherName || "").trim();
          const phoneNo = String(row.phoneNo).replace(/\.0$/, "").trim();
          const aadhaarNo = String(row.aadhaarNo).replace(/\.0$/, "").trim();
          const address = row.address ? String(row.address).trim() : null;

          const totalFee = Number(row.totalFee);
          const discountPercent = Number(row.discountPercent || 0);

          if (!name || !fatherName || !phoneNo || !aadhaarNo || !row.dob) {
            throw new Error("Missing required fields");
          }

          let dobDate: Date;
          if (typeof row.dob === "number") {
            const d = XLSX.SSF.parse_date_code(row.dob);
            dobDate = new Date(d.y, d.m - 1, d.d);
          } else {
            dobDate = new Date(row.dob);
          }

          if (isNaN(dobDate.getTime())) {
            throw new Error("Invalid DOB");
          }

          const password = dobDate
            .toISOString()
            .split("T")[0]
            .replace(/-/g, "");

          const hashedPassword = await bcrypt.hash(password, 10);

          const user = await tx.user.create({
            data: {
              name,
              email,
              password: hashedPassword,
              role: Role.STUDENT,
              schoolId,
            },
          });

          const student = await tx.student.create({
            data: {
              userId: user.id,
              schoolId,
              dob: dobDate,
              address,
              fatherName,
              aadhaarNo,
              phoneNo,
              classId: null,
            },
          });

          const finalFee = totalFee * (1 - discountPercent / 100);

          await tx.studentFee.create({
            data: {
              studentId: student.id,
              totalFee,
              discountPercent,
              finalFee,
              amountPaid: 0,
              remainingFee: finalFee,
              installments: 3,
            },
          });

          created.push({ row: i + 2, name });
        } catch (err: any) {
          failed.push({ row: i + 2, error: err.message });
        }
      }
    }, {
      timeout: 60000,   // 🔥 60 seconds
      maxWait: 20000,
    });

    return NextResponse.json({
      message: "Bulk upload completed",
      createdCount: created.length,
      failedCount: failed.length,
      created,
      failed,
    });

  } catch (err: any) {
    console.error("Bulk upload error", err);
    return NextResponse.json({ message: err.message }, { status: 500 });
  }
}
