import { NextRequest, NextResponse } from "next/server";
import { llmComplete } from "@/lib/generation";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import {
  buildEvidencePack,
  consistencyScore,
  deterministicContradictions,
  MAX_SCAN_ITEMS,
  type Contradiction,
  type ScanItem,
} from "@/lib/consistency";

/**
 * Consistency Engine — cross-content contradiction scan.
 *
 * Scans ALL of a persona's posts/scripts against EACH OTHER (not just the
 * persona rules): deterministic claim pair detection + one LLM semantic pass.
 *
 * Two response modes:
 *  - Default: JSON (back-compat for any caller).
 *  - `Accept: text/event-stream`: Server-Sent Events carrying REAL progress —
 *    stage events fire as each layer actually starts, an info event reports
 *    what Layer 1 found the moment it lands, and the full result arrives as
 *    the `result` event. The panel renders honest progress instead of a
 *    timed guess.
 */

function parseJsonLoose(content: string): Record<string, unknown> | null {
  const trimmed = content.trim();
  const candidates: string[] = [];
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) candidates.push(fenceMatch[1]);
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  candidates.push(trimmed);
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim());
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // try next
    }
  }
  return null;
}

interface ScanPayload {
  score: number;
  contradictions: Contradiction[];
  scanned: number;
  scannedPosted: number;
  scannedAt: string;
  note?: string;
}

/** Progress events the stream mode emits, in real execution order. */
type ScanEvent =
  | { type: "stage"; stage: string; label: string; pct: number }
  | { type: "info"; layer1Found: number }
  | { type: "result"; payload: ScanPayload }
  | { type: "error"; error: string };

/**
 * The full scan, calling `emit` as real work happens. Returns the final
 * payload so both response modes share one implementation — no drift.
 */
async function performScan(
  persona: {
    name: string;
    backstory: string | null;
    toneOfVoice: string | null;
    lifestylePillars: unknown;
    contentRules: unknown;
    forbiddenTopics: unknown;
  },
  items: ScanItem[],
  emit: (event: ScanEvent) => void
): Promise<ScanPayload> {
  const scannedAt = new Date().toISOString();
  const scannedPosted = items.filter((i) => i.posted).length;

  if (items.length < 2) {
    const payload: ScanPayload = {
      score: 100,
      contradictions: [],
      scanned: items.length,
      scannedPosted,
      scannedAt,
      note: "Need at least 2 pieces of content to scan for contradictions.",
    };
    emit({ type: "result", payload });
    return payload;
  }

  emit({ type: "stage", stage: "reading", label: "Reading your posts and scripts…", pct: 15 });

  // Layer 1: deterministic pairs (instant, free, precise).
  emit({ type: "stage", stage: "layer1", label: "Layer 1 — exact-claim matching across everything…", pct: 35 });
  const deterministic = deterministicContradictions(items);
  const deterministicPairs = new Set(
    deterministic.map((c) => [c.a.quote, c.b.quote].sort().join("||"))
  );
  emit({ type: "info", layer1Found: deterministic.length });

  // Layer 2: one LLM semantic pass over compressed evidence.
  emit({ type: "stage", stage: "layer2", label: "Layer 2 — semantic read-through in context…", pct: 65 });
  const personaJson = JSON.stringify({
    name: persona.name,
    backstory: persona.backstory?.slice(0, 600),
    tone: persona.toneOfVoice,
    pillars: persona.lifestylePillars,
    rules: persona.contentRules,
    forbidden: persona.forbiddenTopics,
  });

  const systemPrompt = `You are a brand-consistency auditor. You will see numbered pieces of content (#1..#${Math.min(items.length, MAX_SCAN_ITEMS)}) written under one persona, plus the persona definition.

Find pairs of content that CONTRADICT EACH OTHER: claimed facts, lifestyle, habits, possessions, relationships, diet, routine, location, numbers, opinions, or tone that a follower would notice as inconsistent.

Persona: ${personaJson}

Return ONLY valid JSON:
{"contradictions":[{
  "a": {"n": <content number>, "quote": "exact fragment from it"},
  "b": {"n": <content number>, "quote": "exact fragment from it"},
  "why": "one sentence on what a follower would notice",
  "severity": "high" | "medium" | "low",
  "resolution": "one concrete way to fix it"
}]}

RULES:
- Only REAL contradictions between two different pieces of content. No pair = empty array. Do not invent.
- "high" = hard fact flip (diet, relationship, possessions, core story). "medium" = habit/routine flip. "low" = tone or opinion drift.
- Quotes must be exact fragments (under 15 words) from the numbered content.
- Max 8 contradictions, strongest first.
- JSON only — no fences, no commentary.`;

  const userPrompt = `Content:\n\n${buildEvidencePack(items)}`;

  let llmContradictions: Contradiction[] = [];
  try {
    /**
     * One unified provider chain (OpenRouter → OpenAI → Anthropic → built-in,
     * with retries + JSON mode — see src/lib/generation.ts). Replaces the old
     * hand-rolled branch that hardcoded the region-blocked openai/gpt-4o-mini.
     */
    const llm = await llmComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      0.2,
      { json: true }
    );
    const content = llm.content;

    const parsed = parseJsonLoose(content || "");
    if (parsed && Array.isArray(parsed.contradictions)) {
      const mapped: (Contradiction | null)[] = (
        parsed.contradictions as Record<string, unknown>[]
      ).map((c) => {
        const a = (c.a ?? {}) as Record<string, unknown>;
        const b = (c.b ?? {}) as Record<string, unknown>;
        const aIdx = Number(a.n);
        const bIdx = Number(b.n);
        const aItem = Number.isFinite(aIdx) ? items[aIdx - 1] : undefined;
        const bItem = Number.isFinite(bIdx) ? items[bIdx - 1] : undefined;
        if (!aItem || !bItem || aItem.id === bItem.id) return null;
        const severity =
          c.severity === "high" ? "high" : c.severity === "low" ? "low" : "medium";
        return {
          a: {
            quote: String(a.quote || "").slice(0, 200),
            itemId: aItem.id,
            date: aItem.createdAt,
            type: aItem.type,
          },
          b: {
            quote: String(b.quote || "").slice(0, 200),
            itemId: bItem.id,
            date: bItem.createdAt,
            type: bItem.type,
          },
          why: String(c.why || "").slice(0, 300),
          severity: severity as Contradiction["severity"],
          resolution: String(c.resolution || "").slice(0, 300),
          source: "llm" as const,
        } satisfies Contradiction;
      });
      llmContradictions = mapped.filter((c): c is Contradiction => {
        if (!c) return false;
        // Identical quotes on both sides = duplicate draft, not a contradiction.
        if (c.a.quote.trim().toLowerCase() === c.b.quote.trim().toLowerCase()) return false;
        const key = [c.a.quote, c.b.quote].sort().join("||");
        return !!c.a.quote && !!c.b.quote && !deterministicPairs.has(key);
      });
    }
  } catch (err) {
    console.error("consistency LLM scan failed (deterministic results still ship):", err);
  }

  emit({ type: "stage", stage: "scoring", label: "Scoring and writing fixes…", pct: 90 });
  const contradictions = [...deterministic, ...llmContradictions].slice(0, 12);

  const payload: ScanPayload = {
    score: consistencyScore(contradictions),
    contradictions,
    scanned: items.length,
    scannedPosted,
    scannedAt,
  };
  emit({ type: "result", payload });
  return payload;
}

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let personaId = "";
  try {
    ({ personaId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!personaId) {
    return NextResponse.json({ error: "personaId required" }, { status: 400 });
  }

  const persona = await db.persona.findFirst({ where: { id: personaId, userId } });
  if (!persona) {
    return NextResponse.json({ error: "Persona not found" }, { status: 404 });
  }

  const draftRows = await db.contentDraft.findMany({
    where: { personaId, userId },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  const items: ScanItem[] = draftRows.map((d) => ({
    id: d.id,
    content: d.content,
    type: d.type,
    posted: d.posted,
    createdAt: d.createdAt.toISOString(),
  }));

  const personaForScan = {
    name: persona.name,
    backstory: persona.backstory,
    toneOfVoice: persona.toneOfVoice,
    lifestylePillars: persona.lifestylePillars,
    contentRules: persona.contentRules,
    forbiddenTopics: persona.forbiddenTopics,
  };

  // --- Stream mode: real progress over SSE ---------------------------------
  if ((req.headers.get("accept") || "").includes("text/event-stream")) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: ScanEvent) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        };
        try {
          await performScan(personaForScan, items, send);
        } catch (err) {
          send({ type: "error", error: err instanceof Error ? err.message : "Scan failed" });
        } finally {
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by the client disconnecting — nothing to do
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // --- JSON mode (back-compat) ---------------------------------------------
  try {
    const payload = await performScan(personaForScan, items, () => {});
    return NextResponse.json(payload);
  } catch (err) {
    console.error("consistency scan failed:", err);
    return NextResponse.json({ error: "Scan failed" }, { status: 500 });
  }
}
