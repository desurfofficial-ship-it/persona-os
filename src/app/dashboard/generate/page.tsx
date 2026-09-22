"use client";

/**
 * Agent workspace — Persona OS x OpenMuse integration.
 *
 * Three columns:
 *   left (320px)   : persona selector, content type, model pills
 *   center (flex)  : prompt composer + the agent conversation
 *   right (340px)  : live preview (last 3 chat messages), auto-save note,
 *                    Goals & Tracking ("Content Calendar Automation") panel
 *
 * The active persona id rides the `x-persona-id` header into /api/copilotkit
 * where it is injected server-side as system instructions; the same persona
 * is readable context + the saveToDrafts / saveToVault / createGoal /
 * scheduleContent actions come from hooks/usePersonaAgent.ts.
 *
 * Chat surface: headless useCopilotChat (from @copilotkit/react-core) instead
 * of the prebuilt @copilotkit/react-ui <CopilotChat/>. Same runtime, actions,
 * readables and streaming — but the render fits this page's cream/charcoal
 * identity and keeps the dependency graph small enough for memory-constrained
 * preview environments (the prebuilt UI pulls in Lit + markdown and can OOM
 * small dev boxes). To use the stock UI instead, install @copilotkit/react-ui,
 * import its styles and swap <CopilotChatPane/> for <CopilotChat/>.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CopilotKit, useCopilotChatInternal } from "@copilotkit/react-core";
import { TextMessage, Role } from "@copilotkit/runtime-client-gql";
import { supabase, authedFetch, getSessionToken } from "@/lib/supabase";
import type { Persona } from "@/types/persona";
import { usePersonaAgent, type AgentContentType } from "@/hooks/usePersonaAgent";

const MODELS = [
  { id: "openai/gpt-4o-mini", name: "GPT-4o Mini", hint: "fast + cheap" },
  { id: "anthropic/claude-3-5-haiku", name: "Claude Haiku", hint: "best voice" },
  { id: "google/gemini-flash-1.5", name: "Gemini Flash", hint: "long context" },
  { id: "meta-llama/llama-3.1-8b-instruct", name: "Llama 3.1", hint: "open" },
];

const CONTENT_TYPES: { id: AgentContentType; label: string; example: string }[] = [
  { id: "caption", label: "Caption", example: "a post about today's session" },
  { id: "script", label: "Script", example: "a 30s reel script" },
  { id: "story_arc", label: "Story arc", example: "a 5-part launch arc" },
  { id: "image_prompt", label: "Image prompt", example: "a cover visual" },
];

const ACCENT = "#E76F51";
const CREAM = "#FFFBF5";
const CHARCOAL = "#2B2724";

interface GoalRow {
  id: string;
  personaId: string;
  title: string;
  recurrence: string;
  checkUrl: string;
  status: string;
  nextCheckAt?: string | null;
  lastCheckedAt?: string | null;
  failureCount?: number;
  lastStateSample?: string | null;
}

interface AlertRow {
  id: string;
  goalId: string;
  title: string;
  body: string;
  draftId?: string | null;
  readAt?: string | null;
  createdAt: string;
}

interface Notice {
  id: number;
  text: string;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function timeAgo(iso?: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Human label for a FUTURE timestamp — timeAgo says "just now" for those. */
function timeUntil(iso?: string | null): string {
  if (!iso) return "not scheduled";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `due in ${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `due in ${hours}h`;
  return `due in ${Math.floor(hours / 24)}d`;
}

/**
 * The composer tags every prompt `[Model:…] [Type:…] [Persona:…]` so the wire
 * transcript shows exactly what the agent was asked — but users should never
 * see the raw tags (or the persona UUID). Strip them for display only.
 */
function stripMeta(text: string): string {
  return text
    .replace(/\s*\[(?:Model|Type|Persona):[^\]]*\]/g, "")
    .trim();
}

/** Collapse full UUIDs to 8 chars — tool results read better in small cards. */
function shortUuids(text: string): string {
  return text.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, (m) => `${m.slice(0, 8)}…`);
}

export default function AgentPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");

  // Auth gate + persona load from /api/personas.
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (!alive) return;
      if (!data.user) {
        router.push("/login");
        return;
      }
      setAuthReady(true);
      try {
        const res = await authedFetch("/api/personas");
        const json = (await res.json()) as { personas?: Persona[] };
        const list = Array.isArray(json.personas) ? json.personas : [];
        if (!alive) return;
        setPersonas(list);
        if (list.length > 0) setSelectedId((prev) => prev || list[0].id);
      } catch {
        if (alive) setPersonas([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  const activePersona = useMemo(
    () => personas.find((p) => p.id === selectedId) || null,
    [personas, selectedId]
  );

  // Headers callback — evaluated per runtime request by CopilotKit; a plain
  // closure over state (no ref, no render-time writes).
  const buildHeaders = useCallback((): Record<string, string> => {
    const token = getSessionToken();
    return {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(selectedId ? { "x-persona-id": selectedId } : {}),
    };
  }, [selectedId]);

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm" style={{ background: CREAM, color: CHARCOAL }}>
        Loading agent…
      </div>
    );
  }

  return (
    <CopilotKit runtimeUrl="/api/copilotkit" headers={buildHeaders}>
      <AgentWorkspace
        personas={personas}
        selectedId={selectedId}
        onSelect={setSelectedId}
        activePersona={activePersona}
      />
    </CopilotKit>
  );
}

// ---------------------------------------------------------------------------

function AgentWorkspace({
  personas,
  selectedId,
  onSelect,
  activePersona,
}: {
  personas: Persona[];
  selectedId: string;
  onSelect: (id: string) => void;
  activePersona: Persona | null;
}) {
  const [type, setType] = useState<AgentContentType>("caption");
  const [model, setModel] = useState(MODELS[1].id);
  const [prompt, setPrompt] = useState("");
  const [notices, setNotices] = useState<Notice[]>([]);

  const pushNotice = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setNotices((prev) => [...prev.slice(-2), { id, text }]);
    setTimeout(() => setNotices((prev) => prev.filter((n) => n.id !== id)), 5000);
  }, []);

  // Bump to make the GoalsPanel re-fetch (agent created a goal).
  const [goalsRefresh, setGoalsRefresh] = useState(0);

  // The same internal hook the stock CopilotChat UI uses — its `messages`
  // array carries the AG-UI conversation (user, assistant, tool events).
  const { messages: rawMessages, appendMessage, isLoading } = useCopilotChatInternal();
  const visibleMessages: unknown[] = Array.isArray(rawMessages) ? rawMessages : [];

  // Agent auto-save callbacks — surfaced as honest notices.
  const callbacks = useMemo(
    () => ({
      onDraftSaved: (draftId: string, preview: string) =>
        pushNotice(`Draft saved → /dashboard/drafts · “${preview}…”`),
      onAssetSaved: (_assetId: string, fileName: string) => pushNotice(`Asset saved to vault → ${fileName}`),
      onGoalCreated: (_goalId: string, title: string) => {
        pushNotice(`Goal created → ${title}`);
        setGoalsRefresh((n) => n + 1);
      },
      onScheduled: (draftId: string, publishAt: string) => pushNotice(`Draft ${draftId.slice(0, 8)} scheduled for ${publishAt}`),
    }),
    [pushNotice]
  );
  usePersonaAgent(activePersona, callbacks, { type, model });

  const sendPrompt = async () => {
    const text = prompt.trim();
    if (!text || isLoading) return;
    if (!selectedId) {
      pushNotice("Select a persona first — the agent refuses to guess who it is.");
      return;
    }
    setPrompt("");
    // The wire format: model + type + persona ride inside the message so the
    // transcript always shows exactly what the agent was asked to do.
    // A typed TextMessage instance — the runtime client calls its type-guard
    // methods downstream, so plain objects break the pipeline.
    const message = new TextMessage({ role: Role.User, content: `[Model:${model}] [Type:${type}] [Persona:${selectedId}] ${text}` });
    await appendMessage(message as unknown as Parameters<typeof appendMessage>[0]);
  };

  const lastMessages = visibleMessages.slice(-3);

  return (
    <div
      className="min-h-screen flex flex-col xl:flex-row"
      style={{ background: CREAM, color: CHARCOAL }}
    >
      {/* Scoped CopilotKit theme: cream / charcoal / coral */}
      <style>{`
        .agent-chat {
          --copilot-kit-background-color: ${CREAM};
          --copilot-kit-primary-color: ${ACCENT};
          --copilot-kit-secondary-color: #F4E8DC;
          --copilot-kit-contrast-color: ${CHARCOAL};
          --copilot-kit-muted-color: #8A8177;
          --copilot-kit-separator-color: #EDE3D6;
          --copilot-kit-input-background-color: #FFFFFF;
        }
      `}</style>

      {/* ---------------- LEFT: 320px control sidebar ---------------- */}
      <aside className="w-full xl:w-[320px] xl:min-w-[320px] border-b xl:border-b-0 xl:border-r p-5 space-y-6" style={{ borderColor: "#EDE3D6" }}>
        <div>
          <Link href="/dashboard" className="text-xs underline-offset-2 hover:underline" style={{ color: "#8A8177" }}>
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl leading-tight font-serif" style={{ color: CHARCOAL }}>
            Agent
          </h1>
          <p className="text-xs mt-1" style={{ color: "#8A8177" }}>
            Research → generate → schedule → vault. In character, always.
          </p>
        </div>

        {/* Persona selector */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-2 font-medium" style={{ color: "#8A8177" }}>
            Persona
          </label>
          {personas.length === 0 ? (
            <p className="text-xs leading-relaxed" style={{ color: "#8A8177" }}>
              No personas yet.{" "}
              <Link href="/dashboard/personas/new" className="underline" style={{ color: ACCENT }}>
                Build one first
              </Link>{" "}
              — the agent refuses to guess who it is.
            </p>
          ) : (
            <select
              value={selectedId}
              onChange={(e) => onSelect(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2"
              style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
              aria-label="Active persona"
            >
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.forbidden_topics?.length ? ` · ${p.forbidden_topics.length} forbidden` : ""}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Content type */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-2 font-medium" style={{ color: "#8A8177" }}>
            Content type
          </label>
          <div className="grid grid-cols-2 gap-2">
            {CONTENT_TYPES.map((t) => {
              const active = type === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setType(t.id)}
                  className="rounded-lg border px-3 py-2 text-left text-xs transition-colors"
                  style={{
                    borderColor: active ? ACCENT : "#EDE3D6",
                    borderWidth: active ? 2 : 1,
                    background: active ? "#FFF3EC" : "#FFFFFF",
                    color: CHARCOAL,
                  }}
                  title={t.example}
                >
                  <span className="block font-medium">{t.label}</span>
                  <span className="block text-[10px] mt-0.5" style={{ color: "#8A8177" }}>
                    {t.example}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Model pills */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider mb-2 font-medium" style={{ color: "#8A8177" }}>
            Model
          </label>
          <div className="flex flex-wrap gap-2">
            {MODELS.map((m) => {
              const active = model === m.id;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setModel(m.id)}
                  className="rounded-full border px-3 py-1.5 text-xs transition-colors"
                  style={{
                    borderColor: active ? ACCENT : "#EDE3D6",
                    borderWidth: active ? 2 : 1,
                    background: active ? "#FFF3EC" : "#FFFFFF",
                    color: CHARCOAL,
                  }}
                  title={m.hint}
                >
                  {m.name}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] mt-2" style={{ color: "#8A8177" }}>
            All AI runs through OpenRouter. Selected state shows the coral ring.
          </p>
        </div>

        <p className="text-[10px] leading-relaxed" style={{ color: "#8A8177" }}>
          Prefer the classic engine?{" "}
          <Link href="/dashboard/studio" className="underline" style={{ color: ACCENT }}>
            Studio
          </Link>{" "}
          has ranked variants, thread composer and voice DNA.
        </p>
      </aside>

      {/* ---------------- CENTER: composer + CopilotChat ---------------- */}
      <main className="flex-1 flex flex-col min-w-0 xl:h-screen">
        <div className="p-4 border-b" style={{ borderColor: "#EDE3D6" }}>
          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void sendPrompt();
              }}
              rows={2}
              placeholder={
                activePersona
                  ? `e.g. Research 5 viral wellness hooks this week, write ${type}s for ${activePersona.name}, schedule them, save assets to vault`
                  : "Research 5 viral hooks, generate a week of captions, schedule them…"
              }
              className="flex-1 rounded-xl border bg-white px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2"
              style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
              aria-label="Prompt for the agent"
            />
            <button
              type="button"
              onClick={() => void sendPrompt()}
              disabled={isLoading || !prompt.trim()}
              className="rounded-xl px-5 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              {isLoading ? "Working…" : "Generate"}
            </button>
          </div>
          <p className="text-[10px] mt-1.5" style={{ color: "#8A8177" }}>
            Sends as [Model:{model}] [Type:{type}]
            {selectedId ? ` [Persona:${selectedId.slice(0, 8)}…]` : ""} · ⌘/Ctrl+Enter
          </p>
        </div>

        <CopilotChatPane
          visibleMessages={visibleMessages}
          isLoading={isLoading}
          type={type}
          model={model}
          personaName={activePersona?.name || null}
        />
      </main>

      {/* ---------------- RIGHT: 340px preview + goals ---------------- */}
      <aside className="w-full xl:w-[340px] xl:min-w-[340px] border-t xl:border-t-0 xl:border-l flex flex-col" style={{ borderColor: "#EDE3D6" }}>
        <div className="p-5 border-b" style={{ borderColor: "#EDE3D6" }}>
          <h2 className="font-serif text-lg" style={{ color: CHARCOAL }}>
            Live preview
          </h2>
          <p className="text-[10px] mb-3" style={{ color: "#8A8177" }}>
            Last 3 messages · everything the agent saves lands in /dashboard/drafts and /dashboard/vault automatically.
          </p>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {lastMessages.length === 0 && (
              <p className="text-xs" style={{ color: "#8A8177" }}>
                Nothing yet — send the first prompt.
              </p>
            )}
            {lastMessages.map((m, i) => {
              const raw = m as unknown as { role?: string; content?: unknown; id?: string };
              const role = raw.role;
              const rawContent = typeof raw.content === "string" ? raw.content : "";
              const isUser = role === "user";
              // Display-only: drop the wire tags, shorten ids. The full text
              // stays in the transcript (center pane keeps it raw too).
              const content = isUser ? stripMeta(rawContent) : shortUuids(rawContent);
              return (
                <div
                  key={raw.id || i}
                  className="rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words"
                  style={{
                    borderColor: isUser ? "#EDE3D6" : ACCENT,
                    background: isUser ? "#FFFFFF" : "#FFF3EC",
                    color: CHARCOAL,
                  }}
                >
                  <span className="block text-[9px] uppercase tracking-wider mb-1" style={{ color: isUser ? "#8A8177" : ACCENT }}>
                    {isUser ? "You" : "Agent"}
                  </span>
                  {content.slice(0, 600) || (isUser ? "" : "(working — tool call in progress)")}
                </div>
              );
            })}
          </div>
          {notices.length > 0 && (
            <div className="mt-3 space-y-1.5" aria-live="polite">
              {notices.map((n) => (
                <div key={n.id} className="text-[11px] rounded-md px-2.5 py-1.5" style={{ background: "#EDF5EE", color: "#2F6B37" }}>
                  ✓ {n.text}
                </div>
              ))}
            </div>
          )}
        </div>

        <GoalsPanel activePersona={activePersona} personas={personas} pushNotice={pushNotice} refreshSignal={goalsRefresh} />
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CopilotChatPane — headless rendering of the agent conversation.
// Same stream as the stock <CopilotChat/> (useCopilotChat), styled to this
// page: cream background, charcoal text, coral agent accents. Text messages,
// tool-call chips (saveToDrafts, saveToVault, createGoal, scheduleContent…)
// and tool results are all visible so auto-saves are never a black box.
// ---------------------------------------------------------------------------

function CopilotChatPane({
  visibleMessages,
  isLoading,
  type,
  model,
  personaName,
}: {
  visibleMessages: unknown[];
  isLoading: boolean;
  type: AgentContentType;
  model: string;
  personaName: string | null;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const items = useMemo(() => {
    const source = Array.isArray(visibleMessages) ? visibleMessages : [];
    return source
      .map((m) => m as { id?: string; type?: string; role?: string; content?: unknown; name?: string; toolCalls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>; result?: unknown })
      .filter((m) => {
        // AG-UI shapes (role user/assistant/tool) and legacy class shapes.
        if (m.type === "ActionExecutionMessage") return true;
        if (m.type === "ResultMessage") return true;
        if (m.role === "user" || m.role === "assistant" || m.role === "tool") {
          const hasText = typeof m.content === "string" && m.content.trim().length > 0;
          return hasText || (Array.isArray(m.toolCalls) && m.toolCalls.length > 0);
        }
        return false;
      })
      .slice(-60);
  }, [visibleMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length, isLoading]);

  return (
    <div className="flex-1 flex flex-col min-h-[50vh] xl:min-h-0">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-3">
        <div className="rounded-xl border p-4 text-xs leading-relaxed" style={{ borderColor: "#EDE3D6", background: "#FFFFFF" }}>
          <p className="font-serif text-sm mb-1" style={{ color: CHARCOAL }}>
            Persona Agent
          </p>
          <p style={{ color: "#8A8177" }}>
            {personaName
              ? `Generating ${type} using ${model} for ${personaName}. Ask for research, a week of posts, scheduling or vault saves — the agent acts, not just suggests.`
              : "Pick a persona on the left, then ask for research, posts, scheduling or vault saves."}
          </p>
        </div>

        {items.map((m, i) => {
          const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
          if (toolCalls.length > 0) {
            return (
              <div key={m.id || i} className="flex flex-col gap-1 items-start">
                {toolCalls.map((tc, j) => (
                  <div key={tc.id || j} className="text-[11px] rounded-lg px-3 py-1.5 inline-block" style={{ background: "#FFF3EC", color: ACCENT }}>
                    🔧 {tc.function?.name || "tool"}…
                  </div>
                ))}
              </div>
            );
          }
          if (m.type === "ActionExecutionMessage") {
            return (
              <div key={m.id || i} className="text-[11px] rounded-lg px-3 py-1.5 inline-block" style={{ background: "#FFF3EC", color: ACCENT }}>
                🔧 {m.name}…
              </div>
            );
          }
          if (m.type === "ResultMessage" || m.role === "tool") {
            const result = String(m.result ?? (typeof m.content === "string" ? m.content : "")).slice(0, 200);
            return (
              <div key={m.id || i} className="text-[11px] rounded-lg px-3 py-1.5" style={{ background: "#EDF5EE", color: "#2F6B37" }}>
                ✓ {result}
              </div>
            );
          }
          const isUser = m.role === "user";
          // Wire tags are for the runtime + audit; humans get the clean prompt.
          const content = isUser ? stripMeta(typeof m.content === "string" ? m.content : "") : shortUuids(typeof m.content === "string" ? m.content : "");
          return (
            <div key={m.id || i} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${isUser ? "text-white" : ""}`}
                style={{
                  background: isUser ? ACCENT : "#FFFFFF",
                  color: isUser ? "#FFFFFF" : CHARCOAL,
                  border: isUser ? "none" : "1px solid #EDE3D6",
                }}
              >
                {content}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div className="text-xs px-2" style={{ color: "#8A8177" }} aria-live="polite">
            Working…
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Goals & Tracking — "Content Calendar Automation" (OpenMuse adaptation)
// ---------------------------------------------------------------------------

function GoalsPanel({
  activePersona,
  personas,
  pushNotice,
  refreshSignal,
}: {
  activePersona: Persona | null;
  personas: Persona[];
  pushNotice: (text: string) => void;
  refreshSignal: number;
}) {
  const [goals, setGoals] = useState<GoalRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [open, setOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState("");
  const [recurrence, setRecurrence] = useState<"daily" | "weekly">("weekly");
  const [checkUrl, setCheckUrl] = useState("https://www.tiktok.com/tag/wellness");
  const [goalPersonaId, setGoalPersonaId] = useState("");
  const [saving, setSaving] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    setGoalPersonaId((prev) => prev || activePersona?.id || "");
  }, [activePersona?.id]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authedFetch("/api/goals");
        if (!res.ok) return;
        const json = (await res.json()) as { goals?: GoalRow[]; alerts?: AlertRow[] };
        if (!alive) return;
        setGoals(Array.isArray(json.goals) ? json.goals : []);
        setAlerts(Array.isArray(json.alerts) ? json.alerts : []);
      } catch {
        // Panel stays empty on failure — never blocks the page.
      }
    })();
    return () => {
      alive = false;
    };
  }, [refresh, refreshSignal]);

  const createGoal = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await authedFetch("/api/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goalTitle: goalTitle.trim(),
          recurrence,
          checkUrl: checkUrl.trim(),
          persona_id: goalPersonaId || activePersona?.id,
        }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (!res.ok) throw new Error((json.error as string) || "Failed");
      setGoalTitle("");
      pushNotice(`Goal created → ${goalTitle.trim()}`);
      setRefresh((n) => n + 1);
    } catch (err) {
      pushNotice(`Goal failed: ${err instanceof Error ? err.message : "error"}`);
    } finally {
      setSaving(false);
    }
  };

  const runCheck = async (goalId: string) => {
    setCheckingId(goalId);
    try {
      const res = await authedFetch("/api/goals/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalId }),
      });
      const json = (await res.json()) as {
        results?: Array<{ outcome?: string; detail?: string }>;
      };
      const first = json.results?.[0];
      if (!first) pushNotice("Check ran → goal not due yet (its schedule is respected).");
      else if (first.outcome === "generated") pushNotice("Check ran → page changed → auto-draft created ✓");
      else if (first.outcome === "changed") pushNotice("Check ran → page changed ✓ (alert raised)");
      else if (first.outcome === "baseline") pushNotice("Baseline recorded — next change will trigger.");
      else if (first.outcome === "unchanged") pushNotice("Check ran → nothing new.");
      else pushNotice(`Check ran → ${first.outcome || "error"}${first.detail ? ` (${first.detail})` : ""}`);
      setRefresh((n) => n + 1);
    } catch {
      pushNotice("Check failed to run.");
    } finally {
      setCheckingId(null);
    }
  };

  const removeGoal = async (goalId: string) => {
    try {
      await authedFetch(`/api/goals?id=${encodeURIComponent(goalId)}`, { method: "DELETE" });
      setRefresh((n) => n + 1);
    } catch {
      pushNotice("Could not remove the goal.");
    }
  };

  // Pause = stop the recurring checks without losing history. Resume = run
  // again (the API resets the failure slate and schedules the next check now).
  const toggleGoal = async (goalId: string, next: "active" | "paused") => {
    setTogglingId(goalId);
    try {
      const res = await authedFetch("/api/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: goalId, status: next }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error || "Failed");
      }
      pushNotice(next === "paused" ? "Goal paused — checks stop until you resume it." : "Goal resumed — next check runs now.");
      setRefresh((n) => n + 1);
    } catch (err) {
      pushNotice(err instanceof Error ? `Could not update goal: ${err.message}` : "Could not update goal.");
    } finally {
      setTogglingId(null);
    }
  };

  const unreadCount = alerts.filter((a) => !a.readAt).length;

  // Opened the panel with unread alerts? Give the user a beat to see them,
  // then mark them read so the badge stays meaningful.
  useEffect(() => {
    if (!open || unreadCount === 0) return;
    const t = setTimeout(async () => {
      try {
        await authedFetch("/api/goals/read", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        setRefresh((n) => n + 1);
      } catch {
        // badge stays — honest failure beats silent loss
      }
    }, 2500);
    return () => clearTimeout(t);
  }, [open, unreadCount]);

  return (
    <div className="p-5 overflow-y-auto">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="font-serif text-lg" style={{ color: CHARCOAL }}>
            Content Calendar Automation
            {unreadCount > 0 && !open && (
              <span
                className="ml-2 inline-flex items-center justify-center rounded-full text-[10px] font-sans px-1.5 py-0.5 align-middle"
                style={{ background: ACCENT, color: "#FFFFFF" }}
                title={`${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}`}
              >
                {unreadCount}
              </span>
            )}
          </h2>
          <p className="text-[10px]" style={{ color: "#8A8177" }}>
            Goals &amp; Tracking — recurring page checks that auto-generate drafts
          </p>
        </div>
        <span className="text-xs" style={{ color: ACCENT }}>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "#EDE3D6", background: "#FFFFFF" }}>
            <input
              value={goalTitle}
              onChange={(e) => setGoalTitle(e.target.value)}
              placeholder="Goal title — e.g. Weekly viral check for MIRA"
              className="w-full rounded-lg border px-3 py-2 text-xs bg-white focus:outline-none"
              style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
            />
            <div className="flex gap-2">
              <select
                value={recurrence}
                onChange={(e) => setRecurrence(e.target.value as "daily" | "weekly")}
                className="rounded-lg border px-2 py-2 text-xs bg-white"
                style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
                aria-label="Recurrence"
              >
                <option value="weekly">Weekly</option>
                <option value="daily">Daily</option>
              </select>
              <select
                value={goalPersonaId}
                onChange={(e) => setGoalPersonaId(e.target.value)}
                className="flex-1 rounded-lg border px-2 py-2 text-xs bg-white"
                style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
                aria-label="Goal persona"
              >
                <option value="">Persona…</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.id === activePersona?.id ? " (active)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <input
              value={checkUrl}
              onChange={(e) => setCheckUrl(e.target.value)}
              placeholder="checkUrl — e.g. https://www.tiktok.com/tag/wellness"
              className="w-full rounded-lg border px-3 py-2 text-xs bg-white focus:outline-none"
              style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
            />
            <button
              type="button"
              onClick={() => void createGoal()}
              disabled={saving || !goalTitle.trim() || !checkUrl.trim() || !goalPersonaId}
              className="w-full rounded-lg px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              style={{ background: ACCENT }}
            >
              {saving ? "Creating…" : "Create goal"}
            </button>
            <p className="text-[10px]" style={{ color: "#8A8177" }}>
              The worker reads the page (browser worker when configured), dedupes alerts per change, and auto-writes one
              in-character caption per detected change.
            </p>
          </div>

          {goals.length > 0 && (
            <div className="space-y-2">
              {goals.map((g) => {
                const goalAlerts = alerts.filter((a) => a.goalId === g.id);
                return (
                <div key={g.id} className="rounded-xl border p-3" style={{ borderColor: "#EDE3D6", background: "#FFFFFF" }}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: CHARCOAL }}>
                        {g.title}
                      </p>
                      <p className="text-[10px] mt-0.5 truncate" style={{ color: "#8A8177" }} title={g.checkUrl}>
                        {g.recurrence} · {hostOf(g.checkUrl) || "invalid url"} · checked {timeAgo(g.lastCheckedAt)}
                        {g.failureCount ? ` · ${g.failureCount} failures` : ""}
                      </p>
                      <p className="text-[10px] mt-0.5" style={{ color: g.status === "active" ? "#2F6B37" : "#B3261E" }}>
                        {g.status} · {timeUntil(g.nextCheckAt)}
                      </p>
                      {g.lastStateSample && (
                        <p className="text-[10px] mt-1 leading-snug" style={{ color: "#8A8177" }}>
                          Last snapshot: “{g.lastStateSample.slice(0, 80)}{g.lastStateSample.length > 80 ? "..." : ""}”
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => void runCheck(g.id)}
                        disabled={checkingId === g.id || g.status !== "active"}
                        className="text-[10px] rounded-md border px-2 py-1 disabled:opacity-40"
                        style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
                        title={g.status !== "active" ? "Resume the goal to run checks" : "Check now"}
                      >
                        {checkingId === g.id ? "…" : "Run check"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void toggleGoal(g.id, g.status === "active" ? "paused" : "active")}
                        disabled={togglingId === g.id}
                        className="text-[10px] rounded-md border px-2 py-1 disabled:opacity-40"
                        style={{ borderColor: "#EDE3D6", color: CHARCOAL }}
                      >
                        {togglingId === g.id ? "…" : g.status === "active" ? "Pause" : "Resume"}
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeGoal(g.id)}
                        className="text-[10px] rounded-md px-2 py-1"
                        style={{ color: "#B3261E" }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {goalAlerts.length > 0 && (
                    <div className="mt-2 pt-2 border-t space-y-1" style={{ borderColor: "#F4E8DC" }}>
                      {goalAlerts.slice(0, 3).map((a) => (
                        <div key={a.id} className="text-[10px] leading-snug" style={{ color: "#8A8177" }}>
                          <span style={{ color: ACCENT }}>⚡ {timeAgo(a.createdAt)}</span> — {a.body}
                          {a.draftId && (
                            <Link
                              href={`/dashboard/drafts?q=${encodeURIComponent(g.title.slice(0, 30))}`}
                              className="underline ml-1"
                              style={{ color: ACCENT }}
                            >
                              open the auto-draft →
                            </Link>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          )}

          {/* ---- Goal history: the full alert timeline across all goals ---- */}
          {alerts.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-wider font-medium" style={{ color: "#8A8177" }}>
                Goal history — {alerts.length} alert{alerts.length === 1 ? "" : "s"}, newest first
              </p>
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {alerts.slice(0, 15).map((a) => {
                  const goal = goals.find((g) => g.id === a.goalId);
                  const unread = !a.readAt;
                  return (
                    <div
                      key={a.id}
                      className="rounded-lg px-2.5 py-1.5 text-[11px]"
                      style={{
                        background: "#FFF3EC",
                        borderLeft: unread ? `3px solid ${ACCENT}` : "3px solid transparent",
                        opacity: unread ? 1 : 0.72,
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium truncate" style={{ color: CHARCOAL }}>
                          {unread && <span style={{ color: ACCENT }}>● </span>}{a.title}
                        </span>
                        <span className="shrink-0 text-[9px]" style={{ color: "#8A8177" }}>
                          {timeAgo(a.createdAt)}
                        </span>
                      </div>
                      <span className="block" style={{ color: "#8A8177" }}>
                        {a.body}
                      </span>
                      <span className="block mt-0.5 text-[9px] uppercase tracking-wider" style={{ color: "#B08968" }}>
                        {goal ? `${goal.recurrence} · ${hostOf(goal.checkUrl)}` : "goal removed"}
                      </span>
                      {a.draftId && (
                        <Link
                          href="/dashboard/drafts"
                          className="underline block mt-0.5"
                          style={{ color: ACCENT }}
                        >
                          Open the auto-draft →
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {open && goals.length === 0 && alerts.length === 0 && (
            <p className="text-[11px]" style={{ color: "#8A8177" }}>
              No goals yet. Create one above — the first check runs immediately to record a baseline,
              then the schedule takes over. Every detected change lands here with the draft it produced.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
