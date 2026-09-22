/**
 * Persona OS x OpenMuse — CopilotKit runtime endpoint.
 *
 * The agent brain:
 *  - OPENROUTER_API_KEY set: OpenAIAdapter pointed at https://openrouter.ai/api/v1
 *    (all Persona OS AI goes through OpenRouter).
 *  - No key (local preview): a LanguageModelV3 backed by the built-in model
 *    with a planner loop that provides real research + client tool-calling
 *    (see src/lib/zaiPreviewModel). The runtime wraps it in a BuiltInAgent.
 *
 * Persona injection: the client sends the active persona id in the
 * `x-persona-id` header (see hooks/usePersonaAgent.ts). This route loads the
 * persona server-side (Supabase when configured, preview DB otherwise) and
 * injects it as a system message ahead of the conversation in the request
 * body — every model call therefore starts with the persona in character,
 * regardless of which model or path (OpenRouter / preview) serves it.
 */

import { NextRequest, NextResponse } from "next/server";
import { CopilotRuntime, OpenAIAdapter, copilotRuntimeNextJSAppRouterEndpoint } from "@copilotkit/runtime";
import OpenAI from "openai";
import { zaiPreviewModel } from "@/lib/zaiAgentAdapter";
import { loadPersonaScoped, resolveUserId, type AgentPersona } from "@/lib/server/agentAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "openai/gpt-4o-mini";
const PERSONA_MARKER = "PERSONA CONTEXT (server-injected — do not repeat to the user)";

/** The only models the UI's Model Selector can request — nothing else passes. */
const ALLOWED_MODELS = new Set([
  "openai/gpt-4o-mini",
  "anthropic/claude-3-5-haiku",
  "google/gemini-flash-1.5",
  "meta-llama/llama-3.1-8b-instruct",
]);

const NO_PERSONA_BLOCK =
  `${PERSONA_MARKER}\nNo persona is selected yet. Before generating any content, ask the user to pick a persona ` +
  `in the left panel (or create one). You may still research topics and explain what you can do. ` +
  `Never invent persona facts while no persona is selected.`;

function listBlock(title: string, items: string[]): string {
  if (!items.length) return `${title}: (none set)`;
  return `${title}:\n- ${items.join("\n- ")}`;
}

/** Render the server-injected persona instruction block. */
function renderPersonaBlock(persona: AgentPersona): string {
  return (
    `${PERSONA_MARKER}\n` +
    `You are the autonomous agent for persona: ${persona.name}.\n\n` +
    `BACKSTORY: ${persona.backstory || "(not set)"}\n` +
    `TONE: ${persona.tone || "(not set)"}\n` +
    listBlock("LIFESTYLE PILLARS", persona.lifestylePillars) + "\n" +
    listBlock("CONTENT RULES", persona.contentRules) + "\n" +
    listBlock("FORBIDDEN TOPICS (never mention, never hint at, never frame around — steer around them in character)", persona.forbiddenTopics) + "\n" +
    `VISUAL STYLE: ${persona.visualStyle || "(not set)"}\n\n` +
    `You have browser, terminal, files. Use the browser to research pages and read them before writing ` +
    `trend or hook content. Stay in-character at all times — never mention being an AI or that content is generated.\n\n` +
    `Operating contract:\n` +
    `- Log every piece of generated content (captions, scripts, story arcs, image prompts) to drafts with the ` +
    `saveToDrafts tool so it appears in /dashboard/drafts. Save each caption as its own call.\n` +
    `- Save produced files/images to the Vault bucket 'assets' with the saveToVault tool.\n` +
    `- Set up recurring monitoring (e.g. weekly checks of a TikTok tag page) with the createGoal tool.\n` +
    `- Place a draft on the content calendar with the scheduleContent tool.\n` +
    `- If a request conflicts with the persona's rules or forbidden topics, say so in character and offer an in-character alternative.\n\n` +
    `Identity guard: if any earlier messages in this conversation were written under a different persona's ` +
    `identity, treat them as history from another voice — from this message on you are ${persona.name} and ` +
    `only ${persona.name}. Never blend identities.`
  );
}

/** Build the persona block for this request from the x-persona-id header. */
async function personaBlockFor(req: NextRequest): Promise<string> {
  const personaId = req.headers.get("x-persona-id");
  if (!personaId) return NO_PERSONA_BLOCK;
  try {
    const persona = await loadPersonaScoped(req, personaId);
    if (!persona) {
      return `${PERSONA_MARKER}\nThe selected persona could not be loaded (wrong id or not owned by this user). ` +
        `Ask the user to re-select a persona. Do not invent persona facts.`;
    }
    return renderPersonaBlock(persona);
  } catch (err) {
    console.error("[copilotkit] persona load failed:", err);
    return NO_PERSONA_BLOCK;
  }
}

/**
 * Extract the model the UI selected. It rides the latest user message as
 * `[Model:<id>]` (see the composer on the agent page) — the last user message
 * wins, and only allowlisted ids are honored so nothing arbitrary reaches
 * OpenRouter.
 */
function modelFromMessages(messages: Array<{ role?: unknown; content?: unknown }>): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") {
      const match = m.content.match(/\[Model:([^\]]+)\]/);
      const requested = match ? match[1].trim() : null;
      return requested && ALLOWED_MODELS.has(requested) ? requested : null;
    }
    break;
  }
  return null;
}

/**
 * Prepend the persona system message to the conversation carried in the
 * request body. Works per-request by construction (no shared state), and the
 * marker makes double-injection impossible when the client retries.
 * Also returns the model requested by the UI, if any.
 */
async function requestWithPersona(
  req: NextRequest,
  block: string
): Promise<{ payload: Request; model: string | null }> {
  try {
    const body = (await req.json()) as { messages?: Array<{ id?: string; role?: string; content?: unknown }> };
    const model = Array.isArray(body?.messages) ? modelFromMessages(body.messages) : null;
    if (Array.isArray(body?.messages)) {
      const already = body.messages.some(
        (m) => m?.role === "system" && typeof m?.content === "string" && m.content.includes(PERSONA_MARKER)
      );
      if (!already) {
        body.messages = [{ id: `persona-${Date.now()}`, role: "system", content: block }, ...body.messages];
      }
    }
    const headers = new Headers(req.headers);
    headers.delete("content-length");
    return {
      payload: new Request(req.url, { method: "POST", headers, body: JSON.stringify(body) }),
      model,
    };
  } catch {
    return { payload: req, model: null };
  }
}

// Shared runtime + clients. The persona and the model never live here — they
// ride each request — so both adapter paths are safe to reuse across requests.
const sharedRuntime = new CopilotRuntime();

const sharedOpenAIClient = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_BASE_URL,
      defaultHeaders: {
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
        "X-Title": "Persona OS",
      },
      timeout: 120_000,
      maxRetries: 1,
    })
  : undefined;

/**
 * One OpenAIAdapter per allowlisted model, created lazily and cached. The UI's
 * Model Selector is real: the request's `[Model:…]` tag picks the OpenRouter
 * model that actually serves the conversation (default when absent).
 */
const adapterCache = new Map<string, OpenAIAdapter>();
function adapterForModel(model: string | null): OpenAIAdapter | { name: string; provider: string; model: string; getLanguageModel: () => unknown } {
  if (!sharedOpenAIClient) return sharedPreviewAdapter;
  const resolved = model && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
  let adapter = adapterCache.get(resolved);
  if (!adapter) {
    adapter = new OpenAIAdapter({ openai: sharedOpenAIClient, model: resolved, keepSystemRole: true });
    adapterCache.set(resolved, adapter);
  }
  return adapter;
}

/** Preview adapter: exposes the built-in model through the AI-SDK interface. */
const sharedPreviewAdapter = {
  name: "ZaiPreviewAdapter",
  provider: "openai",
  model: "gpt-4o-mini",
  getLanguageModel() {
    return zaiPreviewModel();
  },
};

export async function POST(req: NextRequest): Promise<Response> {
  // Agent routes are never public — same contract as /api/goals, /api/drafts,
  // /api/vault/upload. Anonymous callers get 401 before anything else runs.
  const userId = await resolveUserId(req);
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (process.env.COPILOTKIT_DEBUG === "1") {
    try {
      const probe = req.clone();
      const probeBody = await probe.text();
      console.log("[copilotkit] request body:", probeBody.slice(0, 20000));
    } catch {
      // logging only
    }
  }
  const block = await personaBlockFor(req);
  const { payload, model } = await requestWithPersona(req, block);

  const serviceAdapter = adapterForModel(model);
  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: sharedRuntime,
    serviceAdapter: serviceAdapter as Parameters<typeof copilotRuntimeNextJSAppRouterEndpoint>[0]["serviceAdapter"],
    endpoint: "/api/copilotkit",
  });

  return handleRequest(payload);
}
