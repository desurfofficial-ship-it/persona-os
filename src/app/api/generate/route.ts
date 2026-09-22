import { NextRequest, NextResponse } from "next/server";
import {
  buildSystemPrompt,
  fingerprintFrom,
  rankVariants,
  runVariant,
  strategiesFor,
  type GenType,
  type PersonaInput,
  type VariantResult,
} from "@/lib/generation";
import type { PlatformId } from "@/lib/platforms";
import { userFromRequest } from "@/lib/local-session";

const VALID_TYPES: GenType[] = ["caption", "script", "story_arc", "image_prompt"];
const VALID_PLATFORMS: PlatformId[] = ["x", "linkedin", "instagram", "threads"];

export async function POST(req: NextRequest) {
  // Agent-family routes are never public: AI quota belongs to signed-in users.
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const persona = body.persona as PersonaInput | undefined;
    const type = body.type as GenType | undefined;

    if (!persona || !type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        { error: "Missing or invalid persona/type" },
        { status: 400 }
      );
    }

    // Legacy callers (ideas, series, drafts improve, persona sample) omit
    // `platform` — they get the old single-string response, no platform
    // formatting, one variant. The generate page sends the full request.
    const legacy = !body.platform;
    const platform: PlatformId = VALID_PLATFORMS.includes(body.platform)
      ? body.platform
      : "x";
    const variants = legacy ? 1 : Math.max(1, Math.min(3, Number(body.variants) || 3));

    const voiceSamples = Array.isArray(body.voiceSamples)
      ? (body.voiceSamples as string[]).filter((s: unknown) => typeof s === "string" && s.length > 20)
      : [];
    // Curated gold set wins when present — it is the voice the user chose to
    // represent them, and it keeps AI-generated drafts from teaching the AI
    // its own voice (drift loop).
    const goldSamples = Array.isArray(body.goldSamples)
      ? (body.goldSamples as string[]).filter((s: unknown) => typeof s === "string" && s.length > 20)
      : [];
    const voiceSource = goldSamples.length ? goldSamples : voiceSamples;
    const postedContext = Array.isArray(body.postedContext)
      ? (body.postedContext as { content?: string }[])
      : [];
    const polish = body.polish === true;
    const moreLike =
      body.moreLike &&
      typeof body.moreLike === "object" &&
      typeof (body.moreLike as { original?: unknown }).original === "string"
        ? {
            original: (body.moreLike as { original: string }).original,
            avoid: Array.isArray((body.moreLike as { avoid?: unknown }).avoid)
              ? ((body.moreLike as { avoid: unknown[] }).avoid as unknown[]).filter(
                  (s): s is string => typeof s === "string"
                )
              : [],
          }
        : undefined;

    // Voice DNA: measured from the persona's real writing (gold set when
    // curated, otherwise drafts + posted content).
    const fingerprint = fingerprintFrom([
      ...voiceSource,
      ...postedContext.map((p) => p.content || ""),
    ]);
    const systemBase = buildSystemPrompt(persona, fingerprint, voiceSource);
    const strategies = strategiesFor(type);

    // strategyOffset lets per-card regeneration rotate structures instead of
    // always producing the same first strategy.
    const offset = Number.isFinite(Number(body.strategyOffset))
      ? Math.abs(Math.floor(Number(body.strategyOffset)))
      : 0;
    const jobs = Array.from({ length: variants }, (_, i) =>
      strategies[(i + offset) % strategies.length]
    );

    const settled = await Promise.allSettled(
      jobs.map((strategy) =>
        runVariant({
          persona,
          type,
          topic: body.topic,
          platform,
          includePlatformBlock: !legacy,
          strategy,
          fingerprint,
          systemBase,
          posted: postedContext,
          asset: body.assetContext,
          rewrite: body.rewrite,
          moreLike,
          polish,
          model: body.model,
        })
      )
    );

    const ok: VariantResult[] = [];
    let failed = 0;
    for (const s of settled) {
      if (s.status === "fulfilled") ok.push(s.value);
      else {
        failed++;
        console.error("Variant failed:", s.reason);
      }
    }

    if (ok.length === 0) {
      const reason = settled[0]?.status === "rejected" ? String(settled[0].reason?.message || settled[0].reason) : "unknown";
      return NextResponse.json(
        { error: `Generation failed on every provider — ${reason.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const ranked = rankVariants(ok);
    const best = ranked.find((v) => !v.blocked) || ranked[0];
    const provider = (settled.find((s) => s.status === "fulfilled") as PromiseFulfilledResult<VariantResult> | undefined)
      ? "chain"
      : "chain";

    const usable = ranked.filter((v) => !v.blocked);
    const fingerprintMeta = fingerprint.samples
      ? {
          used: true,
          samples: fingerprint.samples,
          summary: `${fingerprint.sentenceSpread} rhythm · ${fingerprint.avgSentenceWords} words/sentence · ${fingerprint.casing} casing${fingerprint.topEmojis.length ? ` · uses ${fingerprint.topEmojis.join("")}` : " · no emoji"}`,
          source: goldSamples.length ? "gold" : "drafts",
        }
      : { used: false, samples: 0, summary: "No real posts to learn from yet", source: "none" };

    return NextResponse.json({
      engine: "v2",
      variants: legacy ? [best] : ranked,
      fingerprint: fingerprintMeta,
      provider,
      degraded: failed > 0,
      failed,
      // Legacy single-string shape for ideas / series / drafts / persona sample.
      ...(legacy ? { content: best.content } : {}),
      ...(usable.length === 0 ? { warning: "All variants failed the quality gate — shown with reasons" } : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("generate error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
