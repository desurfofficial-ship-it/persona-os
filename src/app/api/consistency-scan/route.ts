import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
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

  if (items.length < 2) {
    return NextResponse.json({
      score: 100,
      contradictions: [],
      scanned: items.length,
      note: "Need at least 2 pieces of content to scan for contradictions.",
    });
  }

  // Layer 1: deterministic pairs (instant, free, precise).
  const deterministic = deterministicContradictions(items);
  const deterministicPairs = new Set(
    deterministic.map((c) => [c.a.quote, c.b.quote].sort().join("||"))
  );

  // Layer 2: one LLM semantic pass over compressed evidence.
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
    const openrouterKey = process.env.OPENROUTER_API_KEY;
    let content: string | null = null;

    if (openrouterKey) {
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterKey}`,
          "HTTP-Referer": "https://persona-os.app",
          "X-Title": "Persona OS",
        },
        body: JSON.stringify({
          model: "openai/gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          response_format: { type: "json_object" },
        }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await res.json();
      if (res.ok) content = data.choices?.[0]?.message?.content || null;
    }

    if (!content) {
      const zai = await ZAI.create();
      const completion = await zai.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        thinking: { type: "disabled" },
      });
      content = completion.choices[0]?.message?.content || null;
    }

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

  const contradictions = [...deterministic, ...llmContradictions].slice(0, 12);

  return NextResponse.json({
    score: consistencyScore(contradictions),
    contradictions,
    scanned: items.length,
    scannedPosted: items.filter((i) => i.posted).length,
    scannedAt: new Date().toISOString(),
  });
}
