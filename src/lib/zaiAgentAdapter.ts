/**
 * Preview language model for the Persona OS agent (CopilotKit runtime).
 *
 * Used ONLY when OPENROUTER_API_KEY is absent (local preview / zero-key runs).
 * The real deployment uses OpenAIAdapter pointed at OpenRouter — see
 * /api/copilotkit/route.ts.
 *
 * This implements the Vercel AI SDK `LanguageModelV3` interface, which the
 * CopilotKit runtime consumes through `serviceAdapter.getLanguageModel()` →
 * BuiltInAgent. That gives the preview the full agent loop natively:
 *   - streaming text
 *   - native client tool-calls (saveToDrafts / saveToVault / createGoal /
 *     scheduleContent emitted as real tool-call events, executed in the
 *     browser by useCopilotAction)
 *   - server-side research via the platform web_search / page_reader tools
 *     (the built-in model cannot emit tool calls on its own, so a strict-JSON
 *     planner loop inside doStream decides the next step each turn)
 *
 * Every capability here has a first-class path in the real deployment; this
 * model exists so the agent surface is honestly testable without keys.
 */

import ZAI from "z-ai-web-dev-sdk";
import crypto from "crypto";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3FunctionTool,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

// --- Planner prompt ------------------------------------------------------------

const PLANNER_SYSTEM = `You are the planning core of a creator-content agent. You decide the NEXT single step toward the user's request.

Available steps:
- {"step":"research","query":"..."} — web search (fresh results, last 7 days). Use before writing trend/hook content.
- {"step":"read_page","url":"..."} — read one specific web page found by research.
- {"step":"tool","name":"<tool name>","args":{...}} — call ONE of the provided client tools with arguments that match its schema exactly.
- {"step":"answer"} — the visible reply is ready in your final content below the JSON.

Reply with STRICT JSON on the first line, then after the key "REPLY:" write the full user-visible reply (captions, scripts, hooks — whatever was asked). Example:
{"step":"answer"}
REPLY: ...full reply text...

Rules:
- One step per response. Never call the same client tool twice in a row with identical args.
- When tool results or research are already present for a part of the request, move on (next tool or answer) instead of repeating.
- Never invent tool names outside the provided list.
- FORBIDDEN TOPICS: if the persona context lists forbidden topics, the REPLY must not contain those words or close variants — rephrase around them completely, in character.
- Keep the REPLY in the persona's voice when a persona is given. Never mention being an AI.`;

const MAX_STEPS = 5;
const MAX_RESEARCH = 2;

// --- Research tools (platform-native, only reachable inside this model) ---------

async function webSearch(query: string): Promise<string> {
  const zai = await ZAI.create();
  const res = await zai.functions.invoke("web_search", { query, num: 8, recency_days: 7 });
  const results = (res || []) as Array<{ name?: string; url?: string; snippet?: string; date?: string }>;
  if (!results.length) return "No results found.";
  return results
    .slice(0, 8)
    .map((r, i) => `${i + 1}. ${r.name || "(untitled)"}${r.date ? ` (${r.date})` : ""}\n   ${r.url || ""}\n   ${(r.snippet || "").slice(0, 240)}`)
    .join("\n");
}

async function pageReader(url: string): Promise<string> {
  const zai = await ZAI.create();
  const res = await zai.functions.invoke("page_reader", { url });
  const html = res?.data?.html || "";
  const title = res?.data?.title || url;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return `${title}\n\n${text.slice(0, 4000)}`;
}

// --- Prompt flattening ----------------------------------------------------------

type PlainTurn = { role: "system" | "user" | "assistant"; content: string };

function outputToText(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  const o = output as { type?: string; value?: unknown };
  if (o.type === "text" || o.type === "json") return typeof o.value === "string" ? o.value : JSON.stringify(o.value);
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

/** Flatten the AI-SDK prompt into plain text turns the built-in model accepts. */
function flattenPrompt(prompt: LanguageModelV3Prompt): PlainTurn[] {
  const turns: PlainTurn[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      turns.push({ role: "system", content: message.content });
      continue;
    }
    const parts: string[] = [];
    for (const part of message.content as Array<{ type?: string; text?: string; input?: unknown; toolName?: string; output?: unknown }>) {
      if (part.type === "text" && part.text) parts.push(part.text);
      else if (part.type === "tool-call")
        parts.push(`[You used the tool "${part.toolName}" with: ${String(part.input ?? "{}").slice(0, 800)}]`);
      else if (part.type === "tool-result")
        parts.push(`[Tool result for ${part.toolName}]: ${outputToText(part.output).slice(0, 2000)}`);
    }
    const text = parts.join("\n").trim();
    if (text) turns.push({ role: message.role === "assistant" ? "assistant" : "user", content: text });
  }
  return turns;
}

function toolMenu(tools: LanguageModelV3FunctionTool[] | undefined): string {
  const lines: string[] = [];
  for (const tool of tools || []) {
    if (tool.type !== "function") continue;
    lines.push(`- ${tool.name}${tool.description ? ` — ${tool.description}` : ""}\n  args schema: ${JSON.stringify(tool.inputSchema).slice(0, 400)}`);
  }
  return lines.length ? lines.join("\n") : "(no client tools available)";
}

async function chat(plannerPrompt: string, history: PlainTurn[]): Promise<string> {
  const zai = await ZAI.create();
  // The persona block (first system turn) must always survive truncation.
  const personaTurn = history[0]?.role === "system" ? [history[0]] : [];
  const rest = history[0]?.role === "system" ? history.slice(1) : history;
  const completion = await zai.chat.completions.create({
    messages: [
      { role: "system", content: PLANNER_SYSTEM },
      ...personaTurn,
      ...rest.slice(-14),
      { role: "user", content: plannerPrompt },
    ],
    thinking: { type: "disabled" },
  });
  return String(completion?.choices?.[0]?.message?.content || "");
}

interface PlanDecision {
  step: "research" | "read_page" | "tool" | "answer";
  query?: string;
  url?: string;
  name?: string;
  args?: Record<string, unknown>;
  reply?: string;
}

/** Extract the first balanced JSON object from a loose LLM reply. */
function extractJson(text: string): { json: PlanDecision | null; rest: string } {
  const start = text.indexOf("{");
  if (start === -1) return { json: null, rest: text };
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return { json: JSON.parse(text.slice(start, i + 1)) as PlanDecision, rest: text.slice(i + 1) };
        } catch {
          return { json: null, rest: text };
        }
      }
    }
  }
  return { json: null, rest: text };
}

function estimateUsage(text: string) {
  const tokens = Math.ceil(text.length / 4);
  return {
    inputTokens: { total: tokens, noCache: tokens, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: tokens, text: tokens, reasoning: undefined },
  };
}

function finishReason(kind: "tool" | "text") {
  return { unified: (kind === "tool" ? "tool-calls" : "stop") as "tool-calls" | "stop", raw: undefined };
}

// --- The model -------------------------------------------------------------------

const MODEL_PROVIDER = "openai"; // client maps provider → rendering host class
const MODEL_ID = "gpt-4o-mini"; // cosmetic; the actual engine is the built-in model

export function zaiPreviewModel(): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: MODEL_PROVIDER,
    modelId: MODEL_ID,
    supportedUrls: {},
    async doGenerate(options: LanguageModelV3CallOptions) {
      const result = await runPlannerLoop(options, () => {});
      return {
        content:
          result.kind === "tool"
            ? [{ type: "tool-call" as const, toolCallId: result.toolCallId, toolName: result.toolName, input: result.input }]
            : [{ type: "text" as const, text: result.text }],
        finishReason: finishReason(result.kind),
        usage: estimateUsage(result.kind === "tool" ? result.input : result.text),
        warnings: [],
      };
    },
    async doStream(options: LanguageModelV3CallOptions) {
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async start(controller) {
          try {
            controller.enqueue({ type: "stream-start", warnings: [] });
            const result = await runPlannerLoop(options, (part) => controller.enqueue(part));
            if (result.kind === "tool") {
              controller.enqueue({
                type: "tool-call",
                toolCallId: result.toolCallId,
                toolName: result.toolName,
                input: result.input,
              });
            }
            controller.enqueue({
              type: "finish",
              usage: estimateUsage(result.kind === "tool" ? result.input : result.text),
              finishReason: finishReason(result.kind),
            });
          } catch (err) {
            controller.enqueue({ type: "error", error: err instanceof Error ? err : new Error(String(err)) });
          } finally {
            controller.close();
          }
        },
      });
      return { stream };
    },
  };
}

type PlannerResult =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolCallId: string; toolName: string; input: string };

/** The planner loop: research → (more research | client tool | answer). */
async function runPlannerLoop(
  options: LanguageModelV3CallOptions,
  emit: (part: LanguageModelV3StreamPart) => void
): Promise<PlannerResult> {
  const turns: PlainTurn[] = flattenPrompt(options.prompt);
  const tools = (options.tools || []).filter((t): t is LanguageModelV3FunctionTool => t.type === "function");
  let researchUsed = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const plannerPrompt =
      `CLIENT TOOLS (call via {"step":"tool",...}):\n${toolMenu(tools)}\n\n` +
      `Research budget left this turn: ${MAX_RESEARCH - researchUsed}.\n` +
      `Decide the next step for the conversation above.`;

    const raw = await chat(plannerPrompt, turns);
    const { json, rest } = extractJson(raw);

    if (!json) {
      return { kind: "text", text: stripPlanJson(raw.trim()) || "I could not plan that request — try rephrasing it." };
    }

    if (json.step === "research" && json.query && researchUsed < MAX_RESEARCH) {
      researchUsed++;
      let result: string;
      try {
        result = await webSearch(json.query);
      } catch (err) {
        result = `Research failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
      turns.push({ role: "user", content: `[web_search "${json.query}"]\n${result.slice(0, 3500)}` });
      continue;
    }

    if (json.step === "read_page" && json.url) {
      let result: string;
      try {
        result = await pageReader(json.url);
      } catch (err) {
        result = `Page read failed: ${err instanceof Error ? err.message : "unknown error"}`;
      }
      turns.push({ role: "user", content: `[page_reader ${json.url}]\n${result.slice(0, 3500)}` });
      continue;
    }

    if (json.step === "tool" && json.name && tools.some((t) => t.name === json.name)) {
      const input = JSON.stringify(json.args || {});
      return { kind: "tool", toolCallId: crypto.randomUUID(), toolName: json.name, input };
    }

    // step === "answer" (or an unusable tool call) — stream the REPLY.
    const reply = stripPlanJson((json.reply || rest.replace(/^[\s]*REPLY:\s*/i, "")).trim());
    const text = reply || "Done — anything else for this persona?";
    const id = crypto.randomUUID();
    emit({ type: "text-start", id });
    for (const chunk of chunkText(text)) {
      emit({ type: "text-delta", id, delta: chunk });
    }
    emit({ type: "text-end", id });
    return { kind: "text", text };
  }

  return {
    kind: "text",
    text: "I hit my step budget before finishing — ask me to continue and I'll pick up where I stopped.",
  };
}

/** Remove any leftover plan-JSON objects from a user-visible reply. */
function stripPlanJson(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{") {
      // Find the matching close brace.
      let depth = 0;
      let inString = false;
      let escape = false;
      let end = -1;
      for (let j = i; j < text.length; j++) {
        const ch = text[j];
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') inString = !inString;
        if (inString) continue;
        if (ch === "{") depth++;
        if (ch === "}") {
          depth--;
          if (depth === 0) {
            end = j;
            break;
          }
        }
      }
      if (end !== -1) {
        const candidate = text.slice(i, end + 1);
        if (!candidate.includes('"step"')) {
          out += candidate; // ordinary JSON the reply legitimately contains
        }
        i = end + 1;
        continue;
      }
    }
    out += text[i];
    i++;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

function chunkText(text: string): string[] {
  const words = text.split(/(\s+)/);
  const chunks: string[] = [];
  let buffer = "";
  for (const word of words) {
    buffer += word;
    if (buffer.length >= 12) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}
