/**
 * Consistency Engine + Metrics + Due-queue unit tests.
 * Run: bun scripts/test-consistency.ts
 */
import { extractClaims, deterministicContradictions, consistencyScore, buildEvidencePack, splitSentences, type ScanItem } from "../src/lib/consistency";
import { parseMetrics, computePerformance, compactNumber, type MetricsDraft } from "../src/lib/metrics";
import { dueQueue, isOverdue, type CalendarDraft } from "../src/lib/calendar";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const item = (id: string, content: string, posted = true): ScanItem => ({
  id,
  content,
  type: "caption",
  posted,
  createdAt: new Date(Date.now() - Math.random() * 1e10).toISOString(),
});

console.log("\n== CONSISTENCY: SENTENCE SPLIT ==");
check("splits on punctuation", splitSentences("I drive a Lambo. I take the subway! No way?").length === 3, splitSentences("I drive a Lambo. I take the subway! No way?").join("|"));
check("splits on newlines", splitSentences("line one\nline two\n\nline three").length === 3);

console.log("\n== CONSISTENCY: CLAIM EXTRACTION ==");
const claims = extractClaims("I am vegan and I have never touched meat. I drive a Ferrari to the office. I have 2 kids.");
check("finds identity claims", claims.some((c) => c.kind === "identity" || c.value.includes("vegan")), JSON.stringify(claims));
check("finds numeric claims", claims.some((c) => c.kind === "numeric" || c.value.includes("2 kids")), JSON.stringify(claims));
check("finds exclusion claims", claims.some((c) => c.value.includes("never")), JSON.stringify(claims));
const thirdParty = extractClaims("My friend is vegan. She drives a Ferrari. They have kids.");
check("ignores third-person statements", thirdParty.length === 0, JSON.stringify(thirdParty));

console.log("\n== CONSISTENCY: DETERMINISTIC CONTRADICTIONS ==");
const veganSteak = deterministicContradictions([
  item("a", "Day 40 of being vegan. I am vegan for life. Never felt better."),
  item("b", "I just destroyed a ribeye at the new steakhouse. Best steak in town, hands down."),
]);
check("catches vegan vs steak flip", veganSteak.length >= 1, JSON.stringify(veganSteak.map((c) => [c.a.quote, c.b.quote])));
check("vegan flip is high severity", veganSteak[0]?.severity === "high");
check("has resolution guidance", (veganSteak[0]?.resolution || "").length > 10);

const sober = deterministicContradictions([
  item("s1", "I don't drink anymore. Sober 2 years and never been sharper."),
  item("s2", "Tequila night with the team — I lost count of the shots."),
]);
check("catches sober vs tequila flip", sober.length >= 1, JSON.stringify(sober.map((c) => c.a.quote)));

const carBus = deterministicContradictions([
  item("c1", "I drive a Porsche everywhere. My car is my office."),
  item("c2", "I take the subway every day — best thinking time."),
]);
check("catches car vs subway flip", carBus.length >= 1, JSON.stringify(carBus.map((c) => c.a.quote)));

const consistent = deterministicContradictions([
  item("ok1", "Morning run, then I drive to the studio. Coffee. Deep work."),
  item("ok2", "Studio days are my favorite — I drive in early and lift after."),
]);
check("no false positive on consistent content", consistent.length === 0, JSON.stringify(consistent));

const evolution = deterministicContradictions([
  item("e1", "I used to be vegan. I felt weak all the time."),
  item("e2", "I eat steak every day now. Best decision I ever made."),
]);
check("transformation stories are not contradictions", evolution.length === 0, JSON.stringify(evolution.map((c) => [c.a.quote, c.b.quote])));

// Regression: a hypothetical mention ("I'd give up steak") must not block
// detection of the real claim in the same post.
const conditional = deterministicContradictions([
  item("h1", "Day 40 of going fully vegan and I am never looking back. I am vegan for life now. If you told me a year ago I'd give up steak I would have laughed."),
  item("h2", "I just destroyed a ribeye at the new steakhouse downtown. Best steak in the city."),
]);
check("hypothetical mention doesn't block real claim", conditional.length >= 1, JSON.stringify(conditional.map((c) => [c.a.quote, c.b.quote])));
check("quotes are claim sentences not whole posts", conditional[0] ? conditional[0].a.quote.length < 120 && !conditional[0].a.quote.includes("If you told me") : false, conditional[0]?.a.quote);
check("hypothetical-only mention is not a claim", deterministicContradictions([
  item("j1", "I could never give up my morning coffee ritual — it's the small things."),
  item("j2", "I have been shopping for a new coffee machine."),
]).length === 0);

check("score: clean = 100", consistencyScore([]) === 100);
const scored = consistencyScore([
  { a: { quote: "x", itemId: "1", date: "" }, b: { quote: "y", itemId: "2", date: "" }, why: "", severity: "high", resolution: "", source: "deterministic" },
  { a: { quote: "p", itemId: "1", date: "" }, b: { quote: "q", itemId: "2", date: "" }, why: "", severity: "medium", resolution: "", source: "llm" },
]);
check("score: high=20 medium=12", scored === 68, `got ${scored}`);

const pack = buildEvidencePack([item("p1", "short post"), item("p2", "another one", false)]);
check("evidence pack numbers items", pack.includes("#1") && pack.includes("#2"));
check("evidence pack marks posted/draft", pack.includes("posted") && pack.includes("draft"));

console.log("\n== METRICS ==");
check("parseMetrics rejects junk", parseMetrics("nope") === null && parseMetrics({}) === null);
const m = parseMetrics({ platform: "X", views: 1200.7, likes: -5, comments: "12" });
check("parseMetrics coerces + clamps", m?.views === 1201 && m?.likes === 0 && m?.comments === 12, JSON.stringify(m));

const drafts: MetricsDraft[] = [
  { id: "1", content: "post one with strong hook", type: "caption", metrics: { platform: "X", views: 10000, likes: 500, comments: 50, loggedAt: "" } },
  { id: "2", content: "post two", type: "caption", metrics: { platform: "X", views: 2000, likes: 40, comments: 10, loggedAt: "" } },
  { id: "3", content: "post three", type: "script", metrics: { platform: "LinkedIn", views: 5000, likes: 300, comments: 25, loggedAt: "" } },
  { id: "4", content: "posted but not logged", type: "caption" },
];
const perf = computePerformance(drafts, 4);
check("totals add up", perf.totalViews === 17000 && perf.totalLikes === 840);
check("avg views per post", perf.avgViews === Math.round(17000 / 3));
check("engagement % computed", perf.avgEngagement === 5.4, `got ${perf.avgEngagement}`); // 925/17000
check("best post by views", perf.best?.id === "1" && perf.best?.views === 10000);
check("unlogged counted", perf.unloggedPosted === 1, `got ${perf.unloggedPosted}`);
check("platform rollup sorted", perf.platforms[0].platform === "X" && perf.platforms.length === 2);
check("compact numbers", compactNumber(17000) === "17K" && compactNumber(2_500_000) === "2.5M" && compactNumber(999) === "999");
check("empty performance is safe", computePerformance([]).loggedPosts === 0 && computePerformance([]).best === null);

console.log("\n== DUE QUEUE ==");
const now = new Date("2026-09-22T15:00:00");
const cd = (id: string, planned: string | null, posted = false): CalendarDraft => ({
  id, content: `content ${id}`, posted, created_at: "2026-09-20T10:00:00Z", planned_for: planned,
});
const queue = dueQueue([
  cd("future", "2026-09-25T09:00:00Z"),
  cd("today", "2026-09-22T09:00:00Z"),
  cd("overdue", "2026-09-19T09:00:00Z"),
  cd("done", "2026-09-22T09:00:00Z", true),
  cd("unplanned", null),
], now);
check("queue includes today + overdue only", queue.map((q) => q.id).join(",") === "overdue,today", queue.map((q) => q.id).join(","));
check("overdue sorts first", queue[0].id === "overdue");
check("isOverdue works", isOverdue("2026-09-19T09:00:00Z", now) && !isOverdue("2026-09-22T09:00:00Z", now) && !isOverdue(null, now));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
