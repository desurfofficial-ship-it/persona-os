import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import {
  buildSystemPrompt,
  fingerprintFrom,
  rankVariants,
  runVariant,
  strategiesFor,
  type PersonaInput,
} from "@/lib/generation";
import type { VoiceSample } from "@/types/persona";

/**
 * Scheduled auto-generate: turn a queued idea (type="scheduled_idea",
 * autoFill=true) into a real draft on its due day.
 *
 * The honest contract: there is no cron server in this deployment, so the
 * draft is written the first time the user opens the app on/after the due
 * day — the dashboard triggers this endpoint automatically when the user
 * has auto-write enabled, or via the "Draft it now" button.
 *
 * PATCH: edit the idea BEFORE its due day — reword the topic, move the day,
 * or toggle auto-write off (write it yourself when it lands in Drafts).
 * Only untouched ideas (no content yet) are editable; once drafted it's a
 * normal draft and the drafts-page editor takes over.
 */
export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Round-3: drafting a due idea runs real generation (LLM) — 20/min/user,
  // enforced before any validation or provider spend.
  const rl = await rateLimit(`scheduled-ideas:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let ideaId = "";
  try {
    ({ ideaId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!ideaId) {
    return NextResponse.json({ error: "ideaId required" }, { status: 400 });
  }

  const idea = await db.contentDraft.findFirst({ where: { id: ideaId, userId } });
  if (!idea) {
    return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  }
  if (idea.content.trim()) {
    return NextResponse.json({ error: "This idea is already drafted" }, { status: 409 });
  }

  const personaRow = await db.persona.findFirst({
    where: { id: idea.personaId, userId },
  });
  if (!personaRow) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }

  // Voice + posted context, server-side (same shapes the generate page sends).
  const [recentDrafts, postedDrafts] = await Promise.all([
    db.contentDraft.findMany({
      where: { personaId: personaRow.id, content: { not: "" } },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { content: true },
    }),
    db.contentDraft.findMany({
      where: { personaId: personaRow.id, posted: true },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { content: true, createdAt: true },
    }),
  ]);

  const persona = {
    ...personaRow,
    lifestyle_pillars: personaRow.lifestylePillars,
    content_rules: personaRow.contentRules,
    forbidden_topics: personaRow.forbiddenTopics,
    tone_of_voice: personaRow.toneOfVoice,
    voice_samples: personaRow.voiceSamples,
    visual_style: personaRow.visualStyle,
  } as unknown as PersonaInput;

  const goldSet: VoiceSample[] = Array.isArray(personaRow.voiceSamples)
    ? (personaRow.voiceSamples as unknown as VoiceSample[]).filter(
        (s) => s && typeof s.text === "string" && s.enabled && s.text.trim().length > 20
      )
    : [];
  const voiceSource = goldSet.length
    ? goldSet.map((s) => s.text)
    : recentDrafts.map((d) => d.content).filter((c) => c.length > 20);

  const fingerprint = fingerprintFrom([
    ...voiceSource,
    ...postedDrafts.map((p) => p.content),
  ]);
  const systemBase = buildSystemPrompt(persona, fingerprint, voiceSource);
  const [strategy] = strategiesFor("caption");

  try {
    const settled = await runVariant({
      persona,
      type: "caption",
      topic: idea.topic || idea.content,
      platform: "x",
      includePlatformBlock: true,
      strategy,
      fingerprint,
      systemBase,
      posted: postedDrafts,
      polish: true,
    });

    const ranked = rankVariants([settled]);
    const best = ranked.find((v) => !v.blocked) || ranked[0];

    // The idea becomes a normal planned draft: it now shows up in the
    // due-today queue and the drafts list, and leaves the scheduled board.
    await db.contentDraft.update({
      where: { id: idea.id },
      data: {
        content: best.content,
        type: "caption",
        autoFill: false,
      },
    });

    return NextResponse.json({
      ok: true,
      content: best.content,
      voiceMatch: best.voiceMatch,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    console.error("scheduled-ideas draft error:", err);
    return NextResponse.json({ error: message.slice(0, 200) }, { status: 502 });
  }
}

/** Edit an untouched idea: reword the topic, move the day, or turn auto-write off. */
export async function PATCH(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { ideaId?: string; topic?: string; plannedFor?: string | null; autoFill?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ideaId = body.ideaId || "";
  if (!ideaId) return NextResponse.json({ error: "ideaId required" }, { status: 400 });

  const idea = await db.contentDraft.findFirst({ where: { id: ideaId, userId } });
  if (!idea) return NextResponse.json({ error: "Idea not found" }, { status: 404 });
  if (idea.type !== "scheduled_idea" || idea.content.trim()) {
    return NextResponse.json(
      { error: "This idea is already drafted — edit it on the Drafts page" },
      { status: 409 }
    );
  }

  const data: { topic?: string; plannedFor?: Date | null; autoFill?: boolean } = {};

  if (body.topic !== undefined) {
    const topic = body.topic.trim();
    if (!topic) return NextResponse.json({ error: "topic cannot be empty" }, { status: 400 });
    if (topic.length > 500) return NextResponse.json({ error: "topic too long (500 max)" }, { status: 400 });
    data.topic = topic;
  }

  if (body.plannedFor !== undefined) {
    if (body.plannedFor === null || body.plannedFor === "") {
      data.plannedFor = null;
    } else {
      const parsed = new Date(body.plannedFor);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "plannedFor must be an ISO date" }, { status: 400 });
      }
      data.plannedFor = parsed;
    }
  }

  if (body.autoFill !== undefined) {
    data.autoFill = Boolean(body.autoFill);
  }

  if (!Object.keys(data).length) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const updated = await db.contentDraft.update({ where: { id: idea.id }, data });

  return NextResponse.json({
    ok: true,
    idea: {
      id: updated.id,
      topic: updated.topic,
      planned_for: updated.plannedFor,
      auto_fill: updated.autoFill,
    },
  });
}
