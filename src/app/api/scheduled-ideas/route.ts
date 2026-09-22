import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
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
 */
export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
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
