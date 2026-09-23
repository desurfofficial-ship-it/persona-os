/**
 * Probe /api/copilotkit the way the browser client does (AG-UI RunAgentInput).
 * Prints the raw SSE stream so silent failures become visible.
 * Usage: npx tsx scripts/probe-copilotkit.ts [modelId]
 */
const BASE = "http://localhost:3000";
const MODEL = process.argv[2] || "anthropic/claude-3-5-haiku";

async function main() {
  // 1. sign in (demo account)
  const authRes = await fetch(`${BASE}/api/local-auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "signin", email: "demo@persona-os.app", password: "preview123" }),
  });
  const auth = (await authRes.json()) as { token?: string; error?: string };
  if (!auth.token) {
    console.error("AUTH FAILED:", authRes.status, JSON.stringify(auth).slice(0, 200));
    process.exit(1);
  }
  console.log("auth: OK");

  // 2. list personas, grab first id
  const pRes = await fetch(`${BASE}/api/personas`, { headers: { Authorization: `Bearer ${auth.token}` } });
  const pJson = (await pRes.json()) as { personas?: Array<{ id: string; name: string }> };
  const personaId = pJson.personas?.[0]?.id;
  console.log("personas:", pJson.personas?.length ?? 0, "using:", personaId?.slice(0, 8));

  // 3. JSON-RPC request — CopilotKit >=1.46 runtime envelope, captured live
  //    with COPILOTKIT_DEBUG=1: { method, params: { agentId }, body:
  //    <RunAgentInput> }. A bare RunAgentInput body dies with 400
  //    "Missing method field".
  const body = {
    method: "agent/run",
    params: { agentId: "default" },
    body: {
    threadId: `probe-${Date.now()}`,
    runId: `run-${Date.now()}`,
    messages: [
      {
        id: `msg-${Date.now()}`,
        role: "user",
        content: `[Model:${MODEL}] [Type:caption] [Persona:${personaId ?? "none"}] Write one short caption about morning coffee. Then save it to drafts.`,
      },
    ],
    tools: [
      {
        name: "saveToDrafts",
        description: "Save generated content to the drafts collection",
        parameters: { type: "object", properties: { content: { type: "string" }, type: { type: "string" } }, required: ["content"] },
      },
    ],
    state: {},
    context: [],
    forwardedProps: {},
    },
  };

  const res = await fetch(`${BASE}/api/copilotkit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${auth.token}`,
      "x-persona-id": personaId ?? "",
    },
    body: JSON.stringify(body),
  });
  console.log("status:", res.status, res.headers.get("content-type"));

  const reader = res.body?.getReader();
  if (!reader) { console.error("no body"); return; }
  const decoder = new TextDecoder();
  let full = "";
  let events = 0;
  const started = Date.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    events++;
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`stream done in ${secs}s, ${full.length} chars, ${events} chunks`);
  // Show first 3000 chars — enough to see error events or actual generation
  console.log("----STREAM----");
  console.log(full.slice(0, 3000));
  const tail = full.slice(-1500);
  if (full.length > 3000) {
    console.log("----TAIL----");
    console.log(tail);
  }
}

main().catch((e) => { console.error("PROBE ERROR:", e?.message || e); process.exit(1); });
