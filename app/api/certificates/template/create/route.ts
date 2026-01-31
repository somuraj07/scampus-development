import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { name, description, template, imageUrl } = await req.json();

    if (!name || !template) {
      return NextResponse.json(
        { message: "Name and template are required" },
        { status: 400 }
      );
    }

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    const certificateTemplate = await prisma.certificateTemplate.create({
      data: {
        name,
        description: description || null,
        template,
        imageUrl: imageUrl || null,
        schoolId,
        createdById: session.user.id,
      },
    });

    return NextResponse.json(
      { message: "Certificate template created successfully", template: certificateTemplate },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Create certificate template error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
