import { NextRequest, NextResponse } from "next/server";
import {
  buildSystemPrompt,
  fingerprintFrom,
  rankVariants,
  runVariant,
  strategiesFor,
  OPENROUTER_ALLOWED_MODELS,
  type GenType,
  type PersonaInput,
  type VariantResult,
} from "@/lib/generation";
import type { PlatformId } from "@/lib/platforms";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

const VALID_TYPES: GenType[] = ["caption", "script", "story_arc", "image_prompt"];
const VALID_PLATFORMS: PlatformId[] = ["x", "linkedin", "instagram", "threads"];

export async function POST(req: NextRequest) {
  const authUserId = userFromRequest(req);
  if (!authUserId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const rl = await rateLimit(`generate:${clientKey(req, authUserId)}`, 30, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Rate limit exceeded. Retry in ${rl.retryAfterSec}s.` },
      {
        status: 429,
        headers: { "Retry-After": String(rl.retryAfterSec) },
      }
    );
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

    const legacy = !body.platform;
    const platform: PlatformId = VALID_PLATFORMS.includes(body.platform)
      ? body.platform
      : "x";
    const variants = legacy ? 1 : Math.max(1, Math.min(3, Number(body.variants) || 3));

    const voiceSamples = Array.isArray(body.voiceSamples)
      ? (body.voiceSamples as string[]).filter((s: unknown) => typeof s === "string" && s.length > 20)
      : [];
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

    const fingerprint = fingerprintFrom([
      ...voiceSource,
      ...postedContext.map((p) => p.content || ""),
    ]);
    const systemBase = buildSystemPrompt(persona, fingerprint, voiceSource);
    const strategies = strategiesFor(type);

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
          model:
            typeof body.model === "string" && OPENROUTER_ALLOWED_MODELS.has(body.model)
              ? body.model
              : undefined,
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
      const reason =
        settled[0]?.status === "rejected"
          ? String(settled[0].reason?.message || settled[0].reason)
          : "unknown";
      return NextResponse.json(
        { error: `Generation failed on every provider — ${reason.slice(0, 200)}` },
        { status: 502 }
      );
    }

    const ranked = rankVariants(ok);
    const best = ranked.find((v) => !v.blocked) || ranked[0];
    const provider = "chain";

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
      ...(legacy ? { content: best.content } : {}),
      ...(usable.length === 0
        ? { warning: "All variants failed the quality gate — shown with reasons" }
        : {}),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("generate error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
