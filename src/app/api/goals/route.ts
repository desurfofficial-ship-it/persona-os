/**
 * Goals & Tracking — Persona OS x OpenMuse integration.
 *
 * Durable, recurring public-page checks per persona (e.g.
 * https://www.tiktok.com/tag/wellness). The check worker lives at
 * /api/goals/check; it compares page snapshots, raises deduplicated alerts,
 * backs off on failures, and can auto-generate content for the persona when
 * something changes.
 *
 * Dual-mode storage, like the rest of the agent routes:
 *  - Real deployment: Supabase Postgres via Prisma (DATABASE_URL) — the
 *    matching SQL lives in supabase/schema.sql (goals, goal_alerts + RLS).
 *  - Preview: local SQLite via the same Prisma client.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveUserId } from "@/lib/server/agentAuth";

const RECURRENCES = new Set(["daily", "weekly"]);

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const goals = await db.contentGoal.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const goalIds = goals.map((g) => g.id);
  const alerts = goalIds.length
    ? await db.goalAlert.findMany({
        where: { goalId: { in: goalIds } },
        orderBy: { createdAt: "desc" },
        take: 50,
      })
    : [];

  return NextResponse.json({ goals, alerts });
}

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { goalTitle?: string; title?: string; recurrence?: string; checkUrl?: string; persona_id?: string; personaId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = (body.goalTitle || body.title || "").trim();
  const checkUrl = (body.checkUrl || "").trim();
  const recurrence = (body.recurrence || "weekly").toLowerCase();
  const personaId = body.persona_id || body.personaId || "";

  if (!title) return NextResponse.json({ error: "goalTitle required" }, { status: 400 });
  if (!personaId) return NextResponse.json({ error: "persona_id required" }, { status: 400 });
  if (!RECURRENCES.has(recurrence)) {
    return NextResponse.json({ error: "recurrence must be daily or weekly" }, { status: 400 });
  }
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(checkUrl);
  } catch {
    return NextResponse.json({ error: "checkUrl must be a valid http(s) URL" }, { status: 400 });
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) {
    return NextResponse.json({ error: "checkUrl must be http(s)" }, { status: 400 });
  }

  // The persona must belong to the caller.
  const persona = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  const goal = await db.contentGoal.create({
    data: {
      personaId,
      userId,
      title: title.slice(0, 200),
      recurrence,
      checkUrl: checkUrl.slice(0, 1000),
      status: "active",
      // First check runs immediately after creation.
      nextCheckAt: new Date(),
    },
  });

  return NextResponse.json({ goal });
}

export async function PATCH(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id || "";
  const status = (body.status || "").toLowerCase();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!new Set(["active", "paused"]).has(status)) {
    return NextResponse.json({ error: "status must be active or paused" }, { status: 400 });
  }

  const goal = await db.contentGoal.findFirst({ where: { id, userId } });
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  // Resuming clears the failure slate and schedules the next check now,
  // so a paused goal never sits on a stale next_check_at from weeks ago.
  const updated = await db.contentGoal.update({
    where: { id },
    data: {
      status,
      ...(status === "active" ? { failureCount: 0, nextCheckAt: new Date() } : {}),
    },
  });

  return NextResponse.json({ goal: updated });
}

export async function DELETE(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const goal = await db.contentGoal.findFirst({ where: { id, userId } });
  if (!goal) return NextResponse.json({ error: "Goal not found" }, { status: 404 });

  await db.goalAlert.deleteMany({ where: { goalId: id } });
  await db.contentGoal.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
