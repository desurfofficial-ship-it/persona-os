/**
 * Drafts REST endpoint for the agent actions (saveToDrafts, scheduleContent).
 *
 * POST /api/drafts  { persona_id, type, content, model? }  -> create a draft
 * PATCH /api/drafts { id, publishAt?, platform? }          -> schedule (plan) a draft
 *
 * Writes go through Prisma (preview SQLite or Supabase Postgres via
 * DATABASE_URL). The existing Supabase tables stay untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { resolveUserId } from "@/lib/server/agentAuth";

const DRAFT_TYPES = new Set(["caption", "script", "story_arc", "image_prompt"]);

export async function POST(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { persona_id?: string; personaId?: string; type?: string; content?: string; model?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const personaId = body.persona_id || body.personaId || "";
  const type = (body.type || "caption").toLowerCase();
  const content = (body.content || "").trim();

  if (!personaId) return NextResponse.json({ error: "persona_id required" }, { status: 400 });
  if (!DRAFT_TYPES.has(type)) {
    return NextResponse.json({ error: "type must be caption|script|story_arc|image_prompt" }, { status: 400 });
  }
  if (!content) return NextResponse.json({ error: "content required" }, { status: 400 });
  if (content.length > 50_000) return NextResponse.json({ error: "content too long" }, { status: 413 });

  const persona = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!persona) return NextResponse.json({ error: "Persona not found" }, { status: 404 });

  const draft = await db.contentDraft.create({
    data: {
      personaId,
      userId,
      type,
      content,
      // Which model produced it, when the agent tells us (OpenRouter ids).
      tags: body.model ? [`via ${body.model}`.slice(0, 40)] : undefined,
    },
  });

  return NextResponse.json({ draft });
}

export async function PATCH(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { id?: string; draftId?: string; publishAt?: string; platform?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = body.id || body.draftId || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const draft = await db.contentDraft.findFirst({ where: { id, userId } });
  if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });

  let plannedFor: Date | null = draft.plannedFor;
  if (body.publishAt !== undefined) {
    if (body.publishAt === null || body.publishAt === "") {
      plannedFor = null;
    } else {
      const parsed = new Date(body.publishAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "publishAt must be an ISO date" }, { status: 400 });
      }
      plannedFor = parsed;
    }
  }

  const tags = Array.isArray(draft.tags) ? [...(draft.tags as string[])] : [];
  if (body.platform && !tags.some((t) => t.startsWith("for "))) {
    tags.push(`for ${body.platform}`.slice(0, 30));
  }

  const updated = await db.contentDraft.update({
    where: { id },
    data: { plannedFor, tags },
  });

  return NextResponse.json({ draft: updated });
}

export async function GET(req: NextRequest) {
  const userId = await resolveUserId(req);
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const personaId = req.nextUrl.searchParams.get("persona_id") || undefined;
  const drafts = await db.contentDraft.findMany({
    where: { userId, ...(personaId ? { personaId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ drafts });
}
