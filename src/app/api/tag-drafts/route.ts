import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { llmComplete } from "@/lib/generation";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";
import { clientKey, rateLimit } from "@/lib/rateLimit";

/**
 * Auto-tag drafts by text: imported (and other untagged) posts get 3-6
 * lowercase topic/mood tags so the drafts page gains a working filter
 * dimension, and future "write about X" loops can select by theme.
 *
 * Two modes:
 *  - { personaId }      bulk: tag every UNTAGGED draft of the persona
 *                        (import flow fires this fire-and-forget)
 *  - { draftId }        single: suggest tags for ONE draft, any time, and
 *                        MERGE them into what's already there (cap 8) —
 *                        the "Suggest tags" button on the drafts page
 *
 * Never blocks the calling flow — failures here simply leave drafts
 * untagged.
 */

const QUICK = new Set([
  "luxury", "casual", "professional", "night", "beach", "office", "gym", "travel",
]);

function sanitizeTags(raw: string): string[] {
  return raw
    .split(/[,\n]/)
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 \-]/g, "").trim())
    .filter((t) => t.length > 1 && t.length < 30)
    .slice(0, 6);
}

/** Safely read the jsonb tags column as a string[]. */
function draftTagsOf(raw: unknown): string[] {
  return Array.isArray(raw) ? (raw as unknown[]).filter((t): t is string => typeof t === "string") : [];
}

/**
 * Provider-hardened tag suggestion — runs the OpenRouter → built-in chain
 * (see src/lib/generation.ts) instead of calling one SDK directly, so a dead
 * or region-blocked provider can never break tagging.
 */
async function suggestTagsFor(content: string): Promise<string[]> {
  const llm = await llmComplete(
    [
      {
        role: "user",
        content:
          `Tag this social post in 3-6 lowercase keyword tags: the TOPIC (e.g. fitness, money, travel, discipline) and the MOOD (e.g. luxury, gritty, casual, professional). Prefer these when they fit: ${[...QUICK].join(", ")}. Reply with ONLY comma-separated tags.\n\n${content.slice(0, 900)}`,
      },
    ],
    0.3
  );
  return sanitizeTags(llm.content);
}

export async function POST(req: NextRequest) {
  const userId = userFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Round-3: LLM route — 20/min/user, enforced before any validation/LLM spend.
  const rl = await rateLimit(`tag-drafts:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let personaId = "";
  let draftId = "";
  try {
    ({ personaId, draftId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // (provider chain is inside llmComplete — nothing to initialize here)

  // ---- single-draft mode: suggest + MERGE (any draft, any time) ----------
  if (draftId) {
    const draft = await db.contentDraft.findFirst({
      where: { id: draftId, userId },
      select: { id: true, content: true, tags: true },
    });
    if (!draft) return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    if (!draft.content.trim()) {
      return NextResponse.json({ error: "Draft has no content to tag" }, { status: 400 });
    }

    try {
      const fresh = await suggestTagsFor(draft.content);
      if (!fresh.length) {
        return NextResponse.json({ tagged: 0, tags: draftTagsOf(draft.tags), note: "No tags suggested" });
      }
      const existing = draftTagsOf(draft.tags);
      const merged = Array.from(new Set([...existing, ...fresh])).slice(0, 8);
      await db.contentDraft.update({ where: { id: draft.id }, data: { tags: merged } });
      return NextResponse.json({ tagged: 1, tags: merged, added: merged.filter((t) => !existing.includes(t)) });
    } catch (err) {
      console.error("tag-drafts single failure:", err);
      return NextResponse.json({ error: "Tag suggestion failed" }, { status: 502 });
    }
  }

  if (!personaId) {
    return NextResponse.json({ error: "personaId or draftId required" }, { status: 400 });
  }

  const drafts = await db.contentDraft.findMany({
    where: {
      personaId,
      userId,
      tags: { equals: Prisma.DbNull },
      content: { not: "" },
    },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: { id: true, content: true, type: true },
  });

  if (!drafts.length) {
    return NextResponse.json({ tagged: 0, note: "Nothing untagged" });
  }

  let tagged = 0;

  // One call per draft keeps the JSON extraction reliable; failures are
  // isolated per draft.
  for (const d of drafts) {
    try {
      const tags = await suggestTagsFor(d.content);
      if (tags.length) {
        await db.contentDraft.update({ where: { id: d.id }, data: { tags } });
        tagged++;
      }
    } catch (err) {
      console.error("tag-drafts per-item failure:", err);
    }
  }

  return NextResponse.json({ tagged, of: drafts.length });
}
