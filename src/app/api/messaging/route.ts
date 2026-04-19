import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type Sender = "patient" | "dentist";

function isSender(value: unknown): value is Sender {
  return value === "patient" || value === "dentist";
}

export async function POST(req: Request) {
  try {
    let body: { patientId?: unknown; content?: unknown; sender?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Body must be valid JSON." },
        { status: 400 },
      );
    }

    const { patientId, content, sender = "patient" } = body;

    if (typeof patientId !== "string" || !patientId) {
      return NextResponse.json(
        { ok: false, error: "Missing field: patientId." },
        { status: 400 },
      );
    }

    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { ok: false, error: "Missing field: content." },
        { status: 400 },
      );
    }

    if (!isSender(sender)) {
      return NextResponse.json(
        { ok: false, error: "Field sender must be patient or dentist." },
        { status: 400 },
      );
    }

    const thread = await prisma.thread.upsert({
      where: { patientId },
      update: { updatedAt: new Date() },
      create: { patientId },
    });

    const message = await prisma.message.create({
      data: {
        threadId: thread.id,
        content: content.trim(),
        sender,
      },
    });

    return NextResponse.json(
      { ok: true, message, threadId: thread.id },
      { status: 201 },
    );
  } catch (err) {
    console.error("[Messaging] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const patientId = searchParams.get("patientId");

    if (!patientId) {
      return NextResponse.json(
        { ok: false, error: "Missing query parameter: patientId." },
        { status: 400 },
      );
    }

    const thread = await prisma.thread.findUnique({
      where: { patientId },
      include: {
        messages: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!thread) {
      return NextResponse.json({ ok: true, messages: [], threadId: null });
    }

    return NextResponse.json({
      ok: true,
      messages: thread.messages,
      threadId: thread.id,
    });
  } catch (err) {
    console.error("[Messaging] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}
