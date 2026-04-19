import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

interface NotifyRequestBody {
  scanId?: unknown;
  status?: unknown;
  userId?: unknown;
}

export async function POST(req: Request) {
  try {
    let body: NotifyRequestBody;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const { scanId, status, userId = "clinic-default" } = body;

    if (typeof scanId !== "string" || !scanId) {
      return NextResponse.json(
        { ok: false, error: "Missing field: scanId." },
        { status: 400 },
      );
    }

    if (typeof status !== "string" || !status) {
      return NextResponse.json(
        { ok: false, error: "Missing field: status." },
        { status: 400 },
      );
    }

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json(
        { ok: false, error: "Missing field: userId." },
        { status: 400 },
      );
    }

    if (status !== "completed") {
      return NextResponse.json({
        ok: true,
        notification: null,
        message: "No notification created for this status.",
      });
    }

    const scan = await prisma.scan.findUnique({ where: { id: scanId } });
    if (!scan) {
      return NextResponse.json(
        { ok: false, error: "Scan not found." },
        { status: 404 },
      );
    }

    const notification = await prisma.notification.create({
      data: {
        scanId,
        userId,
        type: "scan_completed",
        title: "New Scan Ready for Review",
        message: "A patient has completed a scan.",
      },
    });

    return NextResponse.json({ ok: true, notification }, { status: 201 });
  } catch (err) {
    console.error("[Notify] POST error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");
    const unreadOnly = searchParams.get("unreadOnly") === "true";

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Missing query parameter: userId." },
        { status: 400 },
      );
    }

    const notifications = await prisma.notification.findMany({
      where: {
        userId,
        ...(unreadOnly ? { read: false } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        scan: { select: { id: true, status: true, createdAt: true } },
      },
    });

    return NextResponse.json({ ok: true, notifications });
  } catch (err) {
    console.error("[Notify] GET error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}

export async function PATCH(req: Request) {
  try {
    let body: {
      notificationId?: unknown;
      userId?: unknown;
      markAllRead?: unknown;
    };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        { ok: false, error: "Request body must be valid JSON." },
        { status: 400 },
      );
    }

    const { notificationId, userId, markAllRead = false } = body;

    if (typeof userId !== "string" || !userId) {
      return NextResponse.json(
        { ok: false, error: "Missing field: userId." },
        { status: 400 },
      );
    }

    if (markAllRead === true) {
      const { count } = await prisma.notification.updateMany({
        where: { userId, read: false },
        data: { read: true },
      });

      return NextResponse.json({ ok: true, updated: count });
    }

    if (typeof notificationId !== "string" || !notificationId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Provide notificationId or set markAllRead to true.",
        },
        { status: 400 },
      );
    }

    const existing = await prisma.notification.findUnique({
      where: { id: notificationId },
    });

    if (!existing) {
      return NextResponse.json(
        { ok: false, error: "Notification not found." },
        { status: 404 },
      );
    }

    if (existing.userId !== userId) {
      return NextResponse.json(
        { ok: false, error: "Forbidden." },
        { status: 403 },
      );
    }

    const notification = await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });

    return NextResponse.json({ ok: true, notification });
  } catch (err) {
    console.error("[Notify] PATCH error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal server error." },
      { status: 500 },
    );
  }
}
