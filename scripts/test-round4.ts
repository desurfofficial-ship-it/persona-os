/**
 * Round 4 test suite — the features shipped this round:
 *   1. Thread composer helpers (stripNumbering / renumber / mergePosts /
 *      postStatus / composeThread) — the editable per-post thread UI
 *   2. Multi-platform metric entries (metricEntries / appendEntry /
 *      hasMetrics) + computePerformance treating each platform entry as
 *      one observation
 *   3. Regressions: legacy single-object metrics still parse everywhere
 */

import {
  stripNumbering,
  stripAllNumbering,
  renumber,
  mergePosts,
  postStatus,
  composeThread,
} from "../src/lib/threads";
import {
  metricEntries,
  appendEntry,
  hasMetrics,
  computePerformance,
  parseCount,
} from "../src/lib/metrics";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(
      `FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`
    );
  }
}

/* ---------------- 1. thread composer helpers ---------------- */

check("stripNumbering removes '1/ '", stripNumbering("1/ Hello world"), "Hello world");
check("stripNumbering removes '12/40 ' with total", stripNumbering("12/40 mid thread"), "mid thread");
check("stripNumbering leaves normal text", stripNumbering("2 things I believe"), "2 things I believe");
check("stripNumbering leaves '3/4' inline fraction mid-sentence", stripNumbering("about 3/4 of users"), "about 3/4 of users");

check(
  "stripAllNumbering maps every post",
  stripAllNumbering(["1/ first", "2/ second"]),
  ["first", "second"]
);

const renumbered = renumber(["alpha", "beta", "gamma"], 280);
check("renumber adds i/N tags", renumbered, ["1/3 alpha", "2/3 beta", "3/3 gamma"]);

check(
  "renumber skips tag when it would overflow",
  renumber(["x".repeat(279), "b"], 280),
  ["x".repeat(279), "2/2 b"]
);

check("renumber single post has no tag", renumber(["just one"], 280), ["just one"]);

check(
  "mergePosts joins with blank line when under limit",
  mergePosts(["one", "two"], 0, 280),
  ["one\n\ntwo"]
);

check("mergePosts refuses when merged would overflow", mergePosts(["x".repeat(280), "y"], 0, 280), null);
check("mergePosts accepts exactly-at-limit merge", mergePosts(["x".repeat(277), "y"], 0, 280), ["x".repeat(277) + "\n\ny"]);
check("mergePosts out of range", mergePosts(["a", "b"], 5, 280), null);

check("postStatus ok", postStatus("hello", 280), { len: 5, over: 0, ok: true });
check("postStatus over", postStatus("x".repeat(300), 280), { len: 300, over: 20, ok: false });

const composed = composeThread(["one", "two"], 280);
check(
  "composeThread joins renumbered with separator",
  composed,
  "1/2 one\n\n---\n\n2/2 two"
);

/* ---------------- 2. multi-platform metrics ---------------- */

// Legacy v1 row still parses as a single entry.
const legacy = { platform: "X", views: 12500, likes: 1000, comments: 50, loggedAt: "2026-01-01T00:00:00Z" };
check("metricEntries legacy shape", metricEntries(legacy).length, 1);
check("metricEntries legacy platform", metricEntries(legacy)[0].platform, "X");
check("metricEntries null", metricEntries(null), []);
check("metricEntries junk", metricEntries("nope"), []);

// v2 entries shape.
const v2 = {
  entries: [
    { platform: "X", views: 100, likes: 10, comments: 1, loggedAt: "2026-01-01T00:00:00Z" },
    { platform: "LinkedIn", views: 500, likes: 40, comments: 5, loggedAt: "2026-01-02T00:00:00Z" },
  ],
};
check("metricEntries v2 count", metricEntries(v2).length, 2);
check("metricEntries v2 order", metricEntries(v2)[1].platform, "LinkedIn");
check("metricEntries v2 drops invalid", metricEntries({ entries: [{ views: 5 }, { platform: "X", views: 1, likes: 0, comments: 0, loggedAt: "z" }] }).length, 1);

check("hasMetrics legacy", hasMetrics(legacy), true);
check("hasMetrics empty", hasMetrics({ entries: [] }), false);
check("hasMetrics nothing", hasMetrics(undefined), false);

// appendEntry adds a new platform.
const appended = appendEntry(legacy, { platform: "LinkedIn", views: 900, likes: 80, comments: 9, loggedAt: "2026-02-01T00:00:00Z" });
check("appendEntry grows to 2", appended.entries.length, 2);
check("appendEntry keeps legacy data", appended.entries[0].platform, "X");

// appendEntry replaces the same platform (one truth per platform per post).
const replaced = appendEntry(appended, { platform: "X", views: 13000, likes: 1100, comments: 60, loggedAt: "2026-03-01T00:00:00Z" });
check("appendEntry replaces same platform", replaced.entries.length, 2);
check("appendEntry replacement wins", replaced.entries.find((e) => e.platform === "X")?.views, 13000);

// computePerformance: each entry is one observation.
const drafts = [
  { id: "a", content: "post a", type: "caption", metrics: v2 },
  { id: "b", content: "post b", type: "caption", metrics: legacy },
  { id: "c", content: "post c", type: "caption", metrics: undefined },
];
const perf = computePerformance(drafts, 5);
check("perf totalViews sums all entries", perf.totalViews, 100 + 500 + 12500);
check("perf loggedPosts counts drafts not entries", perf.loggedPosts, 2);
check("perf unloggedPosted", perf.unloggedPosted, 3);
check("perf platforms rollup size", perf.platforms.length, 2);
check("perf platform X rollup", perf.platforms.find((p) => p.platform === "X")?.posts, 2);
check("perf best is X post a-second-entry", perf.best?.views, 12500);
check("perf avgViews per observation", perf.avgViews, Math.round(13100 / 3));

check("regression parseCount 12,500", parseCount("12,500"), 12500);
check("regression parseCount 1.2K", parseCount("1.2K"), 1200);

/* ---------------- summary ---------------- */

console.log(`\ntest-round4: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
