/**
 * POST /api/goals/read — mark the caller's goal alerts as read.
 *
 * The Goals panel shows an unread badge; when the panel is opened the alerts
 * are marked read (after a short beat so the user actually sees them).
 * Body: { ids?: string[] } — specific alerts, or omitted = all of them.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveUserId } from "@/lib/server/agentAuth";

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let ids: string[] = [];
  try {
    const body = (await req.json()) as { ids?: unknown };
    if (Array.isArray(body?.ids)) {
      ids = body.ids.filter((v): v is string => typeof v === "string" && v.length > 0).slice(0, 100);
    }
  } catch {
    // No body — mark everything read.
  }

  const data = await db.goalAlert.updateMany({
    where: { userId, readAt: null, ...(ids.length ? { id: { in: ids } } : {}) },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ updated: data.count });
}
