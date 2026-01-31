import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    if (session.user.role !== "SCHOOLADMIN") {
      return NextResponse.json(
        { message: "Only school admins can generate PDFs" },
        { status: 403 }
      );
    }

    let schoolId = session.user.schoolId;

    if (!schoolId) {
      const adminSchool = await prisma.school.findFirst({
        where: { admins: { some: { id: session.user.id } } },
        select: { id: true },
      });
      schoolId = adminSchool?.id ?? null;
    }

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const { roomAllocationId, copies = 1 } = await req.json();

    if (!roomAllocationId) {
      return NextResponse.json(
        { message: "Room allocation ID is required" },
        { status: 400 }
      );
    }

    const copiesCount = Math.min(Math.max(parseInt(copies) || 1, 1), 10); // Limit to 10 copies

    // Get room allocation with all data
    const roomAllocation = await prisma.roomAllocation.findFirst({
      where: {
        id: roomAllocationId,
        schoolId: schoolId,
      },
      include: {
        school: {
          select: {
            name: true,
            address: true,
          },
        },
        classRooms: {
          include: {
            class: {
              select: {
                id: true,
                name: true,
                section: true,
              },
            },
          },
        },
        studentAssignments: {
          include: {
            student: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                  },
                },
                class: {
                  select: {
                    id: true,
                    name: true,
                    section: true,
                  },
                },
              },
            },
          },
          orderBy: [
            { row: "asc" },
            { column: "asc" },
            { benchPosition: "asc" },
          ],
        },
        teacherAssignments: {
          include: {
            teacher: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!roomAllocation) {
      return NextResponse.json(
        { message: "Room allocation not found" },
        { status: 404 }
      );
    }

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]); // A4 size
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const margin = 50;
    let y = 792; // Start from top

    // Helper function to add text
    const addText = (text: string, x: number, yPos: number, size: number = 12, isBold: boolean = false) => {
      page.drawText(text, {
        x,
        y: yPos,
        size,
        font: isBold ? boldFont : font,
        color: rgb(0, 0, 0),
      });
    };

    // Header
    addText(roomAllocation.school.name, margin, y, 18, true);
    y -= 25;
    addText(`Room Allocation: ${roomAllocation.roomName}`, margin, y, 16, true);
    y -= 20;
    addText(`Generated: ${new Date().toLocaleDateString()}`, margin, y, 10);
    y -= 30;

    // Room Details
    addText("Room Details", margin, y, 14, true);
    y -= 20;
    addText(`Rows: ${roomAllocation.rows}`, margin, y, 12);
    y -= 15;
    addText(`Columns: ${roomAllocation.columns}`, margin, y, 12);
    y -= 15;
    addText(`Students per Bench: ${roomAllocation.studentsPerBench}`, margin, y, 12);
    y -= 15;
    addText(`Total Capacity: ${roomAllocation.rows * roomAllocation.columns * roomAllocation.studentsPerBench}`, margin, y, 12);
    y -= 25;

    // Classes
    if (roomAllocation.classRooms.length > 0) {
      addText("Classes in Room", margin, y, 14, true);
      y -= 20;
      roomAllocation.classRooms.forEach((cr) => {
        addText(`• ${cr.class.name}${cr.class.section ? ` - ${cr.class.section}` : ""}`, margin + 10, y, 12);
        y -= 15;
      });
      y -= 10;
    }

    // Teachers
    if (roomAllocation.teacherAssignments.length > 0) {
      addText("Teachers", margin, y, 14, true);
      y -= 20;
      roomAllocation.teacherAssignments.forEach((ta) => {
        addText(`• ${ta.teacher.name || "N/A"}`, margin + 10, y, 12);
        y -= 15;
      });
      y -= 10;
    }

    // Seating Chart
    addText("Seating Chart", margin, y, 14, true);
    y -= 25;

    // Create seating grid
    const cellWidth = 80;
    const cellHeight = 30;
    const startX = margin;
    const startY = y;

    // Draw grid
    for (let row = 0; row <= roomAllocation.rows; row++) {
      const yPos = startY - (row * cellHeight);
      page.drawLine({
        start: { x: startX, y: yPos },
        end: { x: startX + (roomAllocation.columns * cellWidth), y: yPos },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    for (let col = 0; col <= roomAllocation.columns; col++) {
      const xPos = startX + (col * cellWidth);
      page.drawLine({
        start: { x: xPos, y: startY },
        end: { x: xPos, y: startY - (roomAllocation.rows * cellHeight) },
        thickness: 0.5,
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    // Add row/column labels
    for (let row = 1; row <= roomAllocation.rows; row++) {
      addText(`R${row}`, startX - 20, startY - (row * cellHeight) + 10, 10);
    }

    for (let col = 1; col <= roomAllocation.columns; col++) {
      addText(`C${col}`, startX + (col * cellWidth) - 20, startY + 15, 10);
    }

    // Add student names
    const assignmentMap = new Map<string, any>();
    roomAllocation.studentAssignments.forEach((assignment) => {
      const key = `${assignment.row}-${assignment.column}-${assignment.benchPosition}`;
      assignmentMap.set(key, assignment);
    });

    for (let row = 1; row <= roomAllocation.rows; row++) {
      for (let col = 1; col <= roomAllocation.columns; col++) {
        const xPos = startX + ((col - 1) * cellWidth) + 5;
        const yPos = startY - ((row - 1) * cellHeight) - 10;

        if (roomAllocation.studentsPerBench === 1) {
          const key = `${row}-${col}-1`;
          const assignment = assignmentMap.get(key);
          if (assignment) {
            const studentName = assignment.student.user.name || "N/A";
            const className = assignment.student.class?.name || "";
            addText(studentName.substring(0, 12), xPos, yPos, 8);
            if (className) {
              addText(className.substring(0, 10), xPos, yPos - 10, 7);
            }
          }
        } else {
          // Two students per bench
          const key1 = `${row}-${col}-1`;
          const key2 = `${row}-${col}-2`;
          const assignment1 = assignmentMap.get(key1);
          const assignment2 = assignmentMap.get(key2);

          if (assignment1) {
            const studentName = assignment1.student.user.name || "N/A";
            addText(studentName.substring(0, 10), xPos, yPos, 7);
          }
          if (assignment2) {
            const studentName = assignment2.student.user.name || "N/A";
            addText(studentName.substring(0, 10), xPos, yPos - 10, 7);
          }
        }
      }
    }

    // Generate multiple copies if requested
    const finalPdf = await PDFDocument.create();
    for (let i = 0; i < copiesCount; i++) {
      const [copiedPages] = await finalPdf.copyPages(pdfDoc, [0]);
      finalPdf.addPage(copiedPages);
    }

    const pdfBytes = await finalPdf.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="room-allocation-${roomAllocation.roomName}-${Date.now()}.pdf"`,
      },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
