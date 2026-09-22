import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/local-session";

/**
 * Auto-tag drafts by text: imported (and other untagged) posts get 3-6
 * lowercase topic/mood tags so the drafts page gains a working filter
 * dimension, and future "write about X" loops can select by theme.
 *
 * Never blocks the import flow — callers fire-and-forget; failures here
 * simply leave drafts untagged.
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

  const zai = await ZAI.create();
  let tagged = 0;

  // One call per draft keeps the JSON extraction reliable; failures are
  // isolated per draft.
  for (const d of drafts) {
    try {
      const completion = await zai.chat.completions.create({
        messages: [
          {
            role: "user",
            content:
              `Tag this social post in 3-6 lowercase keyword tags: the TOPIC (e.g. fitness, money, travel, discipline) and the MOOD (e.g. luxury, gritty, casual, professional). Prefer these when they fit: ${[...QUICK].join(", ")}. Reply with ONLY comma-separated tags.\n\n${d.content.slice(0, 900)}`,
          },
        ],
        thinking: { type: "disabled" },
      });
      const content: string = completion.choices?.[0]?.message?.content || "";
      const tags = sanitizeTags(content);
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
