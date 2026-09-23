/**
 * Goals check worker — the OpenMuse "recurring public-page checks" loop,
 * adapted for Persona OS.
 *
 * Auth (either one):
 *  - Task worker: header `x-worker-token` matching env WORKER_TOKEN.
 *  - User session: the normal Bearer session (manual "check now" calls).
 *
 * For every active goal that is due:
 *  1. Read check_url through the Browser Worker (direct-fetch fallback).
 *  2. Hash the normalized page text and compare with the last snapshot.
 *  3. First read = baseline (no alert). Changed = one deduplicated alert per
 *     (goal, content hash) — the same page state never alerts twice.
 *  4. On change, auto-generate one in-character caption for the goal's
 *     persona through the hardened generation engine and attach the draft.
 *  5. Failures back off exponentially (15m * 2^n, capped at 24h); 5
 *     consecutive failures auto-pause the goal instead of failing forever.
 *
 * Callers: TASK_WORKER_ENABLED cron/queue in production (OpenMuse task
 * worker), or POST /api/goals/check { goalId? } from a session.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { resolveUserId } from "@/lib/server/agentAuth";
import { readUrl } from "@/lib/browserWorker";
import { clientKey, rateLimit } from "@/lib/rateLimit";
import {
  runVariant,
  buildSystemPrompt,
  fingerprintFrom,
  strategiesFor,
  type VariantResult,
} from "@/lib/generation";

const BACKOFF_BASE_MS = 15 * 60 * 1000; // 15 minutes
const BACKOFF_CAP_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONSECUTIVE_FAILURES = 5;

function recurrenceIntervalMs(recurrence: string): number {
  return recurrence === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
}

function backoffMs(failureCount: number): number {
  const ms = BACKOFF_BASE_MS * Math.pow(2, Math.max(0, failureCount - 1));
  return Math.min(ms, BACKOFF_CAP_MS);
}

/** Normalize page text so cosmetic markup churn doesn't read as change. */
function normalizeForHash(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "url")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function excerpt(text: string, max = 180): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

interface VoiceSampleLike {
  text?: string;
  enabled?: boolean;
}

/** One caption, generated in-voice through the hardened engine. */
async function autoGenerateForGoal(
  goal: { id: string; title: string; checkUrl: string; personaId: string; userId: string },
  personaRow: {
    name: string;
    backstory: string;
    visualStyle: string | null;
    toneOfVoice: string | null;
    lifestylePillars: unknown;
    contentRules: unknown;
    forbiddenTopics: unknown;
    voiceSamples: unknown;
  },
  userId: string
): Promise<{ draftId: string; variant: VariantResult } | { error: string }> {
  // Voice: curated gold set first, then the persona's recent drafts.
  const goldSamples = Array.isArray(personaRow.voiceSamples)
    ? (personaRow.voiceSamples as VoiceSampleLike[])
        .filter((s) => s && typeof s.text === "string" && s.text.length > 20 && s.enabled !== false)
        .map((s) => s.text as string)
    : [];

  let draftSamples: string[] = [];
  if (goldSamples.length < 3) {
    const recent = await db.contentDraft.findMany({
      where: { personaId: goal.personaId, userId },
      orderBy: { createdAt: "desc" },
      take: 6,
    });
    draftSamples = recent.map((d) => d.content).filter((c) => c && c.length > 20);
  }

  const voiceSource = [...goldSamples, ...draftSamples].slice(0, 8);
  const fingerprint = fingerprintFrom(voiceSource);

  const topic =
    `Goal "${goal.title}" detected new activity on ${goal.checkUrl}. ` +
    `Write one fresh caption that rides what just appeared there. Speak in the persona's voice, ` +
    `reference the theme naturally, and never copy text from the page.`;

  const persona = {
    name: personaRow.name,
    backstory: personaRow.backstory,
    visual_style: personaRow.visualStyle,
    tone_of_voice: personaRow.toneOfVoice,
    lifestyle_pillars: (personaRow.lifestylePillars as string[] | null) ?? null,
    content_rules: (personaRow.contentRules as string[] | null) ?? null,
    forbidden_topics: (personaRow.forbiddenTopics as string[] | null) ?? null,
  };

  const systemBase = buildSystemPrompt(persona, fingerprint, voiceSource);
  const [strategy] = strategiesFor("caption");

  const variant = await runVariant({
    persona,
    type: "caption",
    topic,
    platform: "x",
    includePlatformBlock: false,
    strategy,
    fingerprint,
    systemBase,
    polish: false,
  });

  if (variant.blocked) {
    return { error: variant.blockReason || "generated content failed the quality gate" };
  }

  const draft = await db.contentDraft.create({
    data: {
      personaId: goal.personaId,
      userId,
      type: "caption",
      content: variant.content,
      tags: ["goal", "auto", goal.title.toLowerCase().slice(0, 30)],
    },
  });

  return { draftId: draft.id, variant };
}

export async function POST(req: NextRequest) {
  // --- Auth: worker token or user session ---------------------------------
  const workerHeader = req.headers.get("x-worker-token");
  const workerAuthed =
    Boolean(process.env.WORKER_TOKEN) && workerHeader && workerHeader === process.env.WORKER_TOKEN;

  let userId: string | null = null;
  if (!workerAuthed) {
    userId = await resolveUserId(req);
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized (need worker token or session)" }, { status: 401 });
    }
  }

  // Round-3: the check loop performs server-side page fetches (and can
  // auto-generate content) — 20/min per caller (user, or worker IP).
  const rl = await rateLimit(`goals-check:${clientKey(req, userId)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Retry in ${rl.retryAfterSec}s.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let goalId: string | undefined;
  try {
    const body = (await req.json()) as { goalId?: string };
    goalId = body?.goalId || undefined;
  } catch {
    // No body — fine for worker mode.
  }

  // --- Select due goals ----------------------------------------------------
  const now = new Date();
  const where = {
    status: "active",
    ...(userId ? { userId } : {}),
    ...(goalId ? { id: goalId } : {}),
    OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }],
  };
  const dueGoals = await db.contentGoal.findMany({ where, take: 25 });

  const results: Array<{
    goalId: string;
    title: string;
    outcome: "baseline" | "unchanged" | "changed" | "failed" | "generated";
    via?: string;
    draftId?: string;
    detail?: string;
  }> = [];

  for (const goal of dueGoals) {
    try {
      const read = await readUrl(goal.checkUrl, `goal-${goal.id}`);

      if (!read || !read.text || read.text.trim().length < 40) {
        // Unreadable page (JS-only view, bot wall) — treat as failure + backoff.
        const failures = goal.failureCount + 1;
        await db.contentGoal.update({
          where: { id: goal.id },
          data: {
            failureCount: failures,
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + backoffMs(failures)),
            ...(failures >= MAX_CONSECUTIVE_FAILURES ? { status: "paused" } : {}),
          },
        });
        results.push({
          goalId: goal.id,
          title: goal.title,
          outcome: "failed",
          detail: failures >= MAX_CONSECUTIVE_FAILURES ? "paused after repeated failures" : "empty read",
        });
        continue;
      }

      const hash = sha256(normalizeForHash(read.text));
      const interval = recurrenceIntervalMs(goal.recurrence);

      if (!goal.lastStateHash) {
        // First successful read: record the baseline, never alert on it.
        await db.contentGoal.update({
          where: { id: goal.id },
          data: {
            lastStateHash: hash,
            lastStateSample: excerpt(read.text),
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + interval),
            failureCount: 0,
          },
        });
        results.push({ goalId: goal.id, title: goal.title, outcome: "baseline", via: read.via });
        continue;
      }

      if (hash === goal.lastStateHash) {
        await db.contentGoal.update({
          where: { id: goal.id },
          data: {
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + interval),
            failureCount: 0,
          },
        });
        results.push({ goalId: goal.id, title: goal.title, outcome: "unchanged", via: read.via });
        continue;
      }

      // --- Change detected: deduplicated alert ---------------------------
      const dedupeKey = `goal:${goal.id}:${hash}`;
      const existing = await db.goalAlert.findUnique({ where: { dedupeKey } });
      if (existing) {
        // Already alerted for this exact page state — update position only.
        await db.contentGoal.update({
          where: { id: goal.id },
          data: {
            lastStateHash: hash,
            lastStateSample: excerpt(read.text),
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + interval),
            failureCount: 0,
          },
        });
        results.push({ goalId: goal.id, title: goal.title, outcome: "unchanged", detail: "already alerted for this state" });
        continue;
      }

      // --- Trigger: auto-generate for the persona ------------------------
      let draftId: string | undefined;
      let detail: string | undefined;
      const personaRow = await db.persona.findFirst({ where: { id: goal.personaId, userId: goal.userId } });
      if (personaRow) {
        const generated = await autoGenerateForGoal(
          { id: goal.id, title: goal.title, checkUrl: goal.checkUrl, personaId: goal.personaId, userId: goal.userId },
          personaRow,
          goal.userId
        );
        if ("draftId" in generated) {
          draftId = generated.draftId;
          detail = `voice match ${generated.variant.voiceMatch}%`;
        } else {
          detail = `auto-generate skipped: ${generated.error}`;
        }
      }

      await db.goalAlert.create({
        data: {
          goalId: goal.id,
          userId: goal.userId,
          title: `Change detected: ${goal.title}`,
          body:
            `${goal.checkUrl} changed since the last ${goal.recurrence} check.` +
            (draftId ? " A fresh in-character draft was generated." : detail ? ` (${detail})` : ""),
          dedupeKey,
          draftId: draftId || null,
        },
      });

      await db.contentGoal.update({
        where: { id: goal.id },
        data: {
          lastStateHash: hash,
          lastStateSample: excerpt(read.text),
          lastCheckedAt: new Date(),
          nextCheckAt: new Date(Date.now() + interval),
          failureCount: 0,
        },
      });

      results.push({
        goalId: goal.id,
        title: goal.title,
        outcome: draftId ? "generated" : "changed",
        via: read.via,
        draftId,
        detail,
      });
    } catch (err) {
      // Network/worker error for this goal — back off, keep the loop alive.
      const failures = goal.failureCount + 1;
      try {
        await db.contentGoal.update({
          where: { id: goal.id },
          data: {
            failureCount: failures,
            lastCheckedAt: new Date(),
            nextCheckAt: new Date(Date.now() + backoffMs(failures)),
            ...(failures >= MAX_CONSECUTIVE_FAILURES ? { status: "paused" } : {}),
          },
        });
      } catch (updateErr) {
        console.error("[goals/check] failed to record failure:", updateErr);
      }
      results.push({
        goalId: goal.id,
        title: goal.title,
        outcome: "failed",
        detail: err instanceof Error ? err.message.slice(0, 200) : "unknown error",
      });
    }
  }

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    checked: results.length,
    worker: Boolean(workerAuthed),
    results,
  });
}
