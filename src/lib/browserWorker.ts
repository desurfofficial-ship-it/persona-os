/**
 * Browser Worker client — Persona OS x OpenMuse integration.
 *
 * Talks to the OpenMuse browser worker: a token-protected Playwright service
 * with persistent profiles. In the OpenMuse repo it is started with
 * `pnpm dev:browser` (or the full computer stack via
 * `docker build -t openmuse-computer:local apps/computer`), and it exposes
 * session-scoped navigation, reading, screenshots and PDF import.
 *
 * Contract (Bearer WORKER_TOKEN, JSON):
 *   POST /sessions                     { profile? }            -> { sessionId }
 *   POST /sessions/:id/navigate        { url }                 -> { url, title, status }
 *   POST /sessions/:id/read                                    -> { title, text }
 *   POST /sessions/:id/screenshot                              -> { imageBase64 }
 *   POST /sessions/:id/import-pdf      { url }                 -> { title, text, pages }
 *   DELETE /sessions/:id                                       -> { closed: true }
 *
 * When no worker is configured or reachable, `readUrl` degrades to a direct
 * fetch + HTML strip so goal checks keep working (honest degradation — the
 * result is labeled `via: "direct"` vs `via: "browser-worker"`).
 */

const WORKER_URL = (process.env.BROWSER_WORKER_URL || "http://127.0.0.1:8790").replace(/\/+$/, "");
const WORKER_TOKEN = process.env.WORKER_TOKEN || "";

const DEFAULT_TIMEOUT_MS = 45_000;

export interface BrowserWorkerConfigured {
  configured: boolean;
  url: string;
}

export function browserWorkerInfo(): BrowserWorkerConfigured {
  return { configured: Boolean(process.env.BROWSER_WORKER_URL && WORKER_TOKEN), url: WORKER_URL };
}

export interface BrowserSession {
  sessionId: string;
  profile: string;
  via: "browser-worker";
}

async function workerFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const headers = new Headers(rest.headers || {});
  headers.set("Authorization", `Bearer ${WORKER_TOKEN}`);
  if (rest.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(`${WORKER_URL}${path}`, {
      ...rest,
      headers,
      signal: controller.signal,
      // The worker is local-network; never send browser credentials.
      credentials: "omit",
    });
  } finally {
    clearTimeout(timer);
  }
}

function requireToken(): void {
  if (!WORKER_TOKEN) {
    throw new Error("WORKER_TOKEN is not set — browser worker calls are disabled");
  }
}

/**
 * Start a persistent browser session. `profile` keeps cookies/localStorage
 * across checks (one profile per goal or persona gives stable readings).
 */
export async function startSession(profile = "persona-os"): Promise<BrowserSession> {
  requireToken();
  const res = await workerFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({ profile }),
  });
  if (!res.ok) {
    throw new Error(`Browser worker startSession failed: ${res.status} ${await res.text().catch(() => "")}`.slice(0, 300));
  }
  const data = (await res.json()) as { sessionId?: string; id?: string };
  const sessionId = data.sessionId || data.id;
  if (!sessionId) throw new Error("Browser worker returned no sessionId");
  return { sessionId, profile, via: "browser-worker" };
}

export interface NavigateResult {
  url: string;
  title: string;
  status: number;
}

export async function navigate(sessionId: string, url: string): Promise<NavigateResult> {
  requireToken();
  const res = await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/navigate`, {
    method: "POST",
    body: JSON.stringify({ url, waitUntil: "domcontentloaded" }),
  });
  if (!res.ok) throw new Error(`Browser worker navigate failed: ${res.status}`);
  return (await res.json()) as NavigateResult;
}

export async function screenshot(sessionId: string): Promise<string> {
  requireToken();
  const res = await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/screenshot`, {
    method: "POST",
    body: JSON.stringify({ fullPage: false }),
  });
  if (!res.ok) throw new Error(`Browser worker screenshot failed: ${res.status}`);
  const data = (await res.json()) as { imageBase64?: string; base64?: string };
  const b64 = data.imageBase64 || data.base64;
  if (!b64) throw new Error("Browser worker returned no screenshot bytes");
  return b64;
}

export interface ReadPageResult {
  title: string;
  text: string;
}

/** Read the rendered text of the page the session is currently on. */
export async function readPage(sessionId: string): Promise<ReadPageResult> {
  requireToken();
  const res = await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/read`, { method: "POST" });
  if (!res.ok) throw new Error(`Browser worker readPage failed: ${res.status}`);
  const data = (await res.json()) as ReadPageResult;
  return { title: data.title || "", text: data.text || "" };
}

export interface ImportPdfResult {
  title: string;
  text: string;
  pages?: number;
}

/** Pull a remote PDF through the worker and return its extracted text. */
export async function importPdf(sessionId: string, url: string): Promise<ImportPdfResult> {
  requireToken();
  const res = await workerFetch(`/sessions/${encodeURIComponent(sessionId)}/import-pdf`, {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error(`Browser worker importPdf failed: ${res.status}`);
  return (await res.json()) as ImportPdfResult;
}

export async function closeSession(sessionId: string): Promise<void> {
  try {
    requireToken();
    await workerFetch(`/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
  } catch {
    // Closing is best-effort hygiene; never surface.
  }
}

// ---------------------------------------------------------------------------
// High-level read used by goal checks
// ---------------------------------------------------------------------------

/** Strip HTML to readable text without pulling in a DOM dependency. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface UrlReadResult {
  title: string;
  text: string;
  via: "browser-worker" | "direct";
}

/**
 * Read a public URL through the browser worker when available, falling back
 * to a direct fetch. Goal checks use this so a missing worker never breaks
 * tracking — it only lowers fidelity.
 *
 * SSRF-hardened: the guard runs on the entry URL AND on every redirect hop
 * (manual redirect loop, max 5) so a public page that 302s to loopback /
 * metadata / a private range is cut off mid-flight.
 */
const MAX_REDIRECTS = 5;

export async function readUrl(url: string, profile = "persona-os"): Promise<UrlReadResult> {
  const { assertPublicHttpUrl } = await import("@/lib/safeUrl");
  const safe = await assertPublicHttpUrl(url);
  if (!safe.ok) throw new Error(`blocked by SSRF guard: ${safe.reason}`);

  const info = browserWorkerInfo();
  if (info.configured) {
    let session: BrowserSession | null = null;
    try {
      session = await startSession(profile);
      await navigate(session.sessionId, url);
      const page = await readPage(session.sessionId);
      if (page.text.trim().length > 0) {
        return { title: page.title, text: page.text, via: "browser-worker" };
      }
    } catch (err) {
      console.error("[browserWorker] worker read failed, falling back to direct fetch:", err);
    } finally {
      if (session) await closeSession(session.sessionId);
    }
  }

  // Direct fallback: plain fetch + strip, walking redirects manually so each
  // hop re-passes the SSRF guard. Works for most public pages; JS-only sites
  // (some TikTok views) may yield little text — the check layer treats empty
  // reads as failures and backs off.
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(current, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: controller.signal,
        redirect: "manual",
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) throw new Error(`redirect ${res.status} with no location`);
        const next = new URL(location, current).toString();
        const hopSafe = await assertPublicHttpUrl(next);
        if (!hopSafe.ok) throw new Error(`redirect target blocked: ${hopSafe.reason}`);
        current = next;
        continue;
      }
      if (!res.ok) throw new Error(`direct fetch failed: ${res.status}`);
      const html = await res.text();
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      return {
        title: titleMatch ? titleMatch[1].trim() : current,
        text: htmlToText(html),
        via: "direct",
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`too many redirects (>${MAX_REDIRECTS})`);
}
