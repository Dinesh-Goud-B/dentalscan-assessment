import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export async function POST(req: Request) {
  try {
    let body: { images?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { success: false, error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const { images } = body;

    if (
      !Array.isArray(images) ||
      images.length === 0 ||
      images.some((image) => typeof image !== "string" || !image)
    ) {
      return NextResponse.json(
        { success: false, error: "Images are required." },
        { status: 400 },
      );
    }

    const scan = await prisma.scan.create({
      data: {
        images: images.join(","),
        status: "completed",
      },
    });

    return NextResponse.json({
      success: true,
      scan,
      scanId: scan.id,
    });
  } catch (err) {
    console.error("Scan API Error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}
