import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import prisma from "@/lib/db";

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { title, description, mediaUrl, mediaType, likeCount, comment, share, save } = await req.json();

    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify news feed belongs to school
    const existingNewsFeed = await prisma.newsFeed.findFirst({
      where: {
        id: id,
        schoolId: schoolId,
      },
    });

    if (!existingNewsFeed) {
      return NextResponse.json(
        { message: "News feed not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    const updatedNewsFeed = await prisma.newsFeed.update({
      where: { id: id },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(mediaUrl !== undefined && { mediaUrl }),
        ...(mediaType !== undefined && { mediaType }),
        ...(likeCount !== undefined && { likeCount }),
        ...(comment !== undefined && { comment }),
        ...(share !== undefined && { share }),
        ...(save !== undefined && { save }),
      },
      include: {
        createdBy: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return NextResponse.json(
      { message: "News feed updated successfully", newsFeed: updatedNewsFeed },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Update news feed error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const schoolId = session.user.schoolId;

    if (!schoolId) {
      return NextResponse.json(
        { message: "School not found in session" },
        { status: 400 }
      );
    }

    // Verify news feed belongs to school
    const existingNewsFeed = await prisma.newsFeed.findFirst({
      where: {
        id: id,
        schoolId: schoolId,
      },
    });

    if (!existingNewsFeed) {
      return NextResponse.json(
        { message: "News feed not found or doesn't belong to your school" },
        { status: 404 }
      );
    }

    await prisma.newsFeed.delete({
      where: { id: id },
    });

    return NextResponse.json(
      { message: "News feed deleted successfully" },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Delete news feed error:", error);
    return NextResponse.json(
      { message: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
