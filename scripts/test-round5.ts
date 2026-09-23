/**
 * Round 5 regression tests — pure helpers only (no DB, no network):
 *  - splitIntoParts (voice gold-set split)
 *  - renumber numbered/unnumbered (thread composer platform modes)
 *  - splitThread at the LinkedIn 3000 limit
 *  - mergePosts overflow guard (regression)
 */
import { splitIntoParts } from "../src/lib/voiceSamples";
import { renumber, mergePosts, postStatus } from "../src/lib/threads";
import { splitThread } from "../src/lib/platforms";

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ---------- splitIntoParts ----------
console.log("splitIntoParts (voice gold-set split)");

const longSample =
  "I used to think rest was a reward you had to earn. Then I burned out twice in one year. " +
  "Now I treat sleep like a meeting with my best client. Non-negotiable. My work got better, " +
  "not worse. The grind myth almost killed the thing I love.";
const parts = splitIntoParts(longSample);
check("multi-sentence sample splits into 2+ parts", !!parts && parts.length >= 2, String(parts?.length));
check("parts rejoin to the full text (no words lost)", !!parts && parts.join(" ").replace(/\s+/g, " ").length >= longSample.replace(/\s+/g, " ").length - 5);
check("every part is over 20 chars (usable as a sample)", !!parts && parts.every((p) => p.length > 20));

check("short sample returns null (nothing to split)", splitIntoParts("Too short. Really.") === null);
check(
  "no sentence break returns null",
  splitIntoParts("a".repeat(180)) === null,
  "one long word/sentence cannot split safely"
);
const shortPair = "First short bit. Second short bit that pushes us past fifty characters total for sure.";
const pairParts = splitIntoParts(shortPair);
check("two short sentences pack into ONE part (null: would fragment)", pairParts === null, String(pairParts));

// ---------- renumber ----------
console.log("renumber (composer platform modes)");
const posts = ["alpha post text", "beta post text", "gamma post text"];
const numbered = renumber(posts, 280, true);
check("numbered=true tags X threads 1/N, 2/N, 3/N", numbered[0].startsWith("1/3 ") && numbered[2].startsWith("3/3 "));
const unnumbered = renumber(posts, 3000, false);
check("numbered=false (LinkedIn) adds no tags", unnumbered.every((p) => !/^\d+\//.test(p)));
check("numbered=false strips any pre-existing numbering", renumber(["2/ beta"], 3000, false)[0] === "beta");

// ---------- splitThread at LinkedIn limit ----------
console.log("splitThread at the 3000-char LinkedIn limit");
const linkedinLong = Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}: ${"content words ".repeat(12)}`).join("\n\n");
const liParts = splitThread(linkedinLong, 3000);
check("splits into multiple parts", liParts.length > 1, String(liParts.length));
check("every part fits 3000", liParts.every((p) => [...p].length <= 3000));
check(
  "rejoin keeps (almost) all content",
  liParts.join(" ").replace(/\s+/g, " ").length >= linkedinLong.replace(/\s+/g, " ").length - 120
);

// ---------- mergePosts regression ----------
console.log("mergePosts (overflow guard regression)");
check("merge refused when over limit", mergePosts(["x".repeat(140), "y".repeat(140)], 0, 280) === null);
check("merge allowed when it fits", (mergePosts(["one", "two"], 0, 280) || []).length === 1);
check("postStatus flags overflow", !postStatus("z".repeat(300), 280).ok && postStatus("hi", 280).ok);

// ---------- summary ----------
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
