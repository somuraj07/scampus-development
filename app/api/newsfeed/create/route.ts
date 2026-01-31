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

    const { title, description, mediaUrl, mediaType, likeCount, comment, share, save } = await req.json();

    if (!title || !description) {
      return NextResponse.json(
        { message: "Title and description are required" },
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

    const newsFeed = await prisma.newsFeed.create({
      data: {
        title,
        description,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        schoolId,
        likeCount: likeCount || 0,
        comment: comment || null,
        share: share || null,
        save: save || 0,
        createdById: session.user.id,
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      { message: "News feed created successfully", newsFeed },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Create news feed error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
