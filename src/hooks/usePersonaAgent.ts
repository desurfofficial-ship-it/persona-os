"use client";

/**
 * usePersonaAgent — the client bridge between Persona OS and the CopilotKit
 * agent runtime (Persona OS x OpenMuse integration).
 *
 * Gives the agent:
 *  - readable context: the active persona (name, tone, rules, forbidden topics)
 *  - saveToDrafts:    log generated content -> /api/drafts -> /dashboard/drafts
 *  - saveToVault:     fetch + store an asset  -> /api/vault/upload (bucket 'assets')
 *  - createGoal:      recurring public-page checks (OpenMuse Goals & Tracking)
 *                     -> /api/goals, executed by /api/goals/check
 *  - scheduleContent: put a draft on the content calendar -> /api/drafts PATCH
 *
 * The active persona id is also sent as the x-persona-id header so the server
 * injects the full persona as system instructions (see /api/copilotkit).
 */

import { useMemo } from "react";
import { useCopilotReadable, useCopilotAction } from "@copilotkit/react-core";
import { authedFetch } from "@/lib/supabase";
import type { Persona } from "@/types/persona";

export type AgentContentType = "caption" | "script" | "story_arc" | "image_prompt";

export interface PersonaAgentCallbacks {
  /** Fired after saveToDrafts succeeds — pages use it to toast / refresh. */
  onDraftSaved?: (draftId: string, preview: string) => void;
  /** Fired after saveToVault succeeds. */
  onAssetSaved?: (assetId: string, fileName: string) => void;
  /** Fired after createGoal succeeds. */
  onGoalCreated?: (goalId: string, title: string) => void;
  /** Fired after scheduleContent succeeds. */
  onScheduled?: (draftId: string, publishAt: string) => void;
}

async function postJson(url: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await authedFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (json.error as string) || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return json;
}

export function usePersonaAgent(
  activePersona: Persona | null,
  callbacks: PersonaAgentCallbacks = {},
  settings?: { type: AgentContentType; model: string }
): { personaId: string | null; headers: Record<string, string> } {
  const personaId = activePersona?.id ?? null;

  // Server-injected persona instructions ride this header on every runtime call.
  const headers = useMemo(() => {
    const map: Record<string, string> = {};
    if (personaId) map["x-persona-id"] = personaId;
    return map;
  }, [personaId]);

  // ---- Readable: the agent always knows who it is -------------------------
  useCopilotReadable(
    {
      description: "The currently active persona (identity, voice, rules).",
      value: activePersona
        ? {
            id: activePersona.id,
            name: activePersona.name,
            backstory: activePersona.backstory,
            tone: activePersona.tone_of_voice,
            lifestyle_pillars: activePersona.lifestyle_pillars,
            content_rules: activePersona.content_rules,
            forbidden_topics: activePersona.forbidden_topics,
            visual_style: activePersona.visual_style,
          }
        : { name: null, note: "No persona selected yet — ask the user to pick one." },
    },
    [activePersona?.id]
  );

  // ---- Readable: the current generation settings (the composer's controls) --
  useCopilotReadable(
    {
      description:
        "Current generation settings chosen in the UI: content type and model. Every request is tagged [Model:..][Type:..][Persona:..] — honor them.",
      value: settings
        ? { type: settings.type, model: settings.model, instruction: `You are generating ${settings.type} using ${settings.model}.` }
        : {},
    },
    [settings?.type, settings?.model]
  );

  // ---- saveToDrafts --------------------------------------------------------
  useCopilotAction(
    {
      name: "saveToDrafts",
      description:
        "Save one generated piece of content (caption, script, story arc or image prompt) to this persona's drafts. " +
        "Call once per piece — e.g. three captions means three calls. Saved drafts appear in /dashboard/drafts.",
      parameters: [
        { name: "type", type: "string", enum: ["caption", "script", "story_arc", "image_prompt"], required: true },
        { name: "content", type: "string", description: "The full, ready-to-post text.", required: true },
        { name: "model", type: "string", description: "Model that produced it, e.g. anthropic/claude-3.5-haiku.", required: false },
      ],
      handler: async ({ type, content, model }) => {
        if (!personaId) throw new Error("No persona selected — ask the user to pick one first.");
        const json = await postJson("/api/drafts", {
          persona_id: personaId,
          type,
          content,
          model: model || undefined,
        });
        const draft = json.draft as { id?: string } | undefined;
        const draftId = draft?.id || "";
        callbacks.onDraftSaved?.(draftId, String(content || "").slice(0, 120));
        return `Saved to drafts as ${type} (${draftId}). Visible in /dashboard/drafts.`;
      },
    },
    [personaId, callbacks.onDraftSaved]
  );

  // ---- saveToVault ---------------------------------------------------------
  useCopilotAction(
    {
      name: "saveToVault",
      description:
        "Store a file in the persona's Vault (bucket 'assets'). Give a fileName and a public url — the file is " +
        "fetched server-side and appears in /dashboard/vault.",
      parameters: [
        { name: "fileName", type: "string", description: "e.g. wellness-hook-board.png", required: true },
        { name: "url", type: "string", description: "Public http(s) URL of the file.", required: true },
      ],
      handler: async ({ fileName, url }) => {
        if (!personaId) throw new Error("No persona selected — ask the user to pick one first.");
        const json = await postJson("/api/vault/upload", {
          persona_id: personaId,
          fileName,
          url,
        });
        const asset = json.asset as { id?: string } | undefined;
        callbacks.onAssetSaved?.(asset?.id || "", fileName);
        return `Saved "${fileName}" to the vault (${json.bytes ?? "?"} bytes). Visible in /dashboard/vault.`;
      },
    },
    [personaId, callbacks.onAssetSaved]
  );

  // ---- createGoal (OpenMuse Goals & Tracking) ------------------------------
  useCopilotAction(
    {
      name: "createGoal",
      description:
        "Create a recurring public-page check for this persona (content calendar automation). " +
        "Example: weekly checks of https://www.tiktok.com/tag/wellness — when the page changes, an alert is raised, " +
        "a fresh in-character draft is generated automatically, and the user is notified.",
      parameters: [
        { name: "goalTitle", type: "string", description: "e.g. 'Weekly viral check for MIRA'", required: true },
        { name: "recurrence", type: "string", enum: ["daily", "weekly"], required: true },
        { name: "checkUrl", type: "string", description: "Public page to watch, e.g. a TikTok tag page.", required: true },
      ],
      handler: async ({ goalTitle, recurrence, checkUrl }) => {
        if (!personaId) throw new Error("No persona selected — ask the user to pick one first.");
        const json = await postJson("/api/goals", {
          goalTitle,
          recurrence,
          checkUrl,
          persona_id: personaId,
        });
        const goal = json.goal as { id?: string } | undefined;
        callbacks.onGoalCreated?.(goal?.id || "", goalTitle);
        return `Goal "${goalTitle}" created (${recurrence} check of ${checkUrl}). The worker will track it and auto-generate drafts when the page changes.`;
      },
    },
    [personaId, callbacks.onGoalCreated]
  );

  // ---- scheduleContent ------------------------------------------------------
  useCopilotAction(
    {
      name: "scheduleContent",
      description:
        "Place a draft on the persona's content calendar. Use the draft id returned by saveToDrafts, or describe " +
        "which recent draft to schedule and use its id from context.",
      parameters: [
        { name: "draftId", type: "string", required: true },
        { name: "publishAt", type: "string", description: "ISO date/datetime to publish, e.g. 2025-09-24T09:00.", required: true },
        { name: "platform", type: "string", description: "x | linkedin | instagram | threads", required: false },
      ],
      handler: async ({ draftId, publishAt, platform }) => {
        if (!draftId) throw new Error("draftId is required — save the draft first, then schedule it.");
        const res = await authedFetch("/api/drafts", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: draftId, publishAt, platform: platform || undefined }),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok) throw new Error((json.error as string) || `Scheduling failed (${res.status})`);
        callbacks.onScheduled?.(draftId, publishAt);
        return `Draft ${draftId} scheduled for ${publishAt}${platform ? ` on ${platform}` : ""}. It now shows in the This-week calendar.`;
      },
    },
    [callbacks.onScheduled]
  );

  return { personaId, headers };
}
