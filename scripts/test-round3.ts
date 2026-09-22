/**
 * Round 3 test suite — the fixes shipped this round:
 *   1. parseCount: lenient platform-style number parsing (12,500 / 1.2K / 3.4M)
 *   2. from-posts paste splitting: blank-line posts, min length, cap 20
 *   3. Imported real posts now enter the Consistency Engine scan pool
 *      (imported vegan post vs generated steak draft must flag)
 */

import { parseCount } from "../src/lib/metrics";
import { deterministicContradictions, type ScanItem } from "../src/lib/consistency";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  }
}

/* ---------------- 1. parseCount ---------------- */

check("parseCount plain", parseCount("980"), 980);
check("parseCount commas", parseCount("12,500"), 12500);
check("parseCount comma+k", parseCount("1.2K"), 1200);
check("parseCount lowercase k", parseCount("3k"), 3000);
check("parseCount millions", parseCount("3.4M"), 3_400_000);
check("parseCount billions", parseCount("1.5b"), 1_500_000_000);
check("parseCount spaces", parseCount("  980 "), 980);
check("parseCount number passthrough", parseCount(2500), 2500);
check("parseCount empty string", parseCount(""), null);
check("parseCount whitespace", parseCount("   "), null);
check("parseCount junk text", parseCount("lots"), null);
check("parseCount negative", parseCount("-5"), null);
check("parseCount double comma garbage", parseCount("1.2.3"), null);
check("parseCount zero", parseCount("0"), 0);
check("parseCount decimal only k", parseCount(".5k"), 500);

/* ---------------- 2. from-posts paste split ---------------- */

// The exact split logic shipped in from-posts/page.tsx.
function splitPastedPosts(posts: string): string[] {
  return posts
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 3)
    .slice(0, 20);
}

check(
  "split on blank lines",
  splitPastedPosts("Post one body\n\nPost two body\n\nPost three body"),
  ["Post one body", "Post two body", "Post three body"]
);
check(
  "blank lines with spaces still split",
  splitPastedPosts("Alpha\n   \nBeta"),
  ["Alpha", "Beta"]
);
check("tiny fragments dropped", splitPastedPosts("ok\n\nA real post body here"), [
  "A real post body here",
]);
check("more than 20 posts capped", splitPastedPosts(Array.from({ length: 30 }, (_, i) => `Post number ${i} with body text`).join("\n\n")).length, 20);
check("single post no split", splitPastedPosts("One long single post that stays whole"), [
  "One long single post that stays whole",
]);

/* ---------------- 3. imported posts in the scan pool ---------------- */

// Simulates the new flow: a real pasted post (imported, posted=true) claims
// vegan; a generated draft claims steak. The deterministic layer must catch
// the pair now that imported posts are stored as drafts.
const items: ScanItem[] = [
  {
    id: "imp-1",
    content:
      "I have been vegan for three years and I have never felt better. Diet is the one thing I refuse to compromise on.",
    type: "imported",
    posted: true,
    createdAt: "2026-01-10T09:00:00Z",
  },
  {
    id: "gen-1",
    content:
      "Just grilled the perfect ribeye. I always say a great steak beats any fancy dinner.",
    type: "x_post",
    posted: false,
    createdAt: "2026-03-20T09:00:00Z",
  },
];

const found = deterministicContradictions(items);
check("imported-vs-generated contradiction flagged", found.length >= 1, true);
if (found.length > 0) {
  check(
    "flagged pair quotes the real claim",
    found[0].a.quote.toLowerCase().includes("vegan") ||
      found[0].b.quote.toLowerCase().includes("vegan"),
    true
  );
  check("severity high for diet flips", found[0].severity, "high");
}

// Control: two consistent posts stay clean.
const clean: ScanItem[] = [
  {
    id: "a",
    content: "I have been vegan for three years and it changed everything.",
    type: "imported",
    posted: true,
    createdAt: "2026-01-10T09:00:00Z",
  },
  {
    id: "b",
    content: "My favorite meal is a big vegan bowl after training.",
    type: "x_post",
    posted: false,
    createdAt: "2026-03-20T09:00:00Z",
  },
];
check("consistent imported+generated stays clean", deterministicContradictions(clean).length, 0);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
