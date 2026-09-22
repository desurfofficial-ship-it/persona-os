/**
 * Engine v2 unit smoke tests — exercises voice.ts, quality.ts, platforms.ts
 * exactly as the server will use them. Run: bun scripts/test-engine.ts
 */
import { extractVoiceFingerprint, renderFingerprintBlock, voiceMatchScore } from "../src/lib/voice";
import { stripMetaWrapping, scrubCliches, detectAiTells, detectForbidden, qualityGate } from "../src/lib/quality";
import { splitThread } from "../src/lib/platforms";
import { platformCheck } from "../src/lib/quality";

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

console.log("\n== VOICE FINGERPRINT ==");
const posts = [
  "i used to think consistency meant posting every day.\nit doesn't.\nit means sounding like yourself every time you show up — even when the topic changes.",
  "unpopular take: most creators don't have a content problem.\nthey have a voice problem.\nevery reword takes them further from the thing that made people follow.",
  "my rule: write it how you'd say it.\nif it sounds like a press release, delete it and start over.",
];
const fp = extractVoiceFingerprint(posts);
check("extracts samples", fp.samples === 3, `got ${fp.samples}`);
check("detects lowercase casing", fp.casing === "lowercase", `got ${fp.casing}`);
check("detects first-person openers", fp.firstPersonOpeners >= 0.15, `got ${fp.firstPersonOpeners}`);
check("detects short rhythm", fp.sentenceSpread === "short-punchy" || fp.sentenceSpread === "varied", `got ${fp.sentenceSpread}`);
check("signature words found", fp.signatureWords.length >= 1, fp.signatureWords.join(","));
const block = renderFingerprintBlock(fp);
check("fingerprint block mentions Voice DNA", block.includes("VOICE DNA"));
check("fingerprint block says no emoji", block.includes("Emoji: NO"));

const onVoice = "i used to think consistency was a schedule thing. it's a voice thing. sounding like yourself is the whole game.";
const offVoice = "Introducing our revolutionary platform! 🚀 As a thought leader, I am delighted to delve into synergistic paradigms that unlock the power of content creation!!";
const onScore = voiceMatchScore(onVoice, fp);
const offScore = voiceMatchScore(offVoice, fp);
check("in-voice text scores higher", onScore > offScore, `${onScore} vs ${offScore}`);
check("in-voice scores well", onScore >= 70, `got ${onScore}`);
check("off-voice scores low", offScore < 70, `got ${offScore}`);

console.log("\n== META WRAPPER STRIPPER ==");
check("strips 'Here's your caption:'", stripMetaWrapping("Here's your caption:\n\nThe real post") === "The real post");
check("strips 'Sure! ...'", stripMetaWrapping("Sure! The real post") === "The real post");
check("strips 'Option 1:'", stripMetaWrapping("Option 1: The real post") === "The real post");
check("strips trailing 'Hope this helps'", stripMetaWrapping("The real post\n\nHope this helps! Let me know if you want changes.") === "The real post");
check("unwraps full quotes", stripMetaWrapping('"The real post"') === "The real post");
check("keeps clean text untouched", stripMetaWrapping("Clean post text") === "Clean post text");

console.log("\n== CLICHÉ SCRUBBER ==");
const scrub = scrubCliches("This is a game-changer that will unlock the power of your workflow. Use it to elevate your strategy.");
check("removes game-changer", !scrub.text.includes("game-changer"));
check("removes unlock the power", !scrub.text.includes("unlock the power"));
check("removes elevate your", !scrub.text.includes("elevate your"));
check("reports what was removed", scrub.removed.length >= 3, `got ${scrub.removed.length}`);
check("leverage → use", scrubCliches("leverage your data").text.includes("use your data"));
check("clean text untouched", scrubCliches("i just post like i talk").removed.length === 0);

console.log("\n== AI TELLS + FORBIDDEN ==");
check("detects 'As an AI'", detectAiTells("As an AI language model, I cannot do that").length >= 2);
check("detects assistant opener", detectAiTells("Certainly! Here is your post").length >= 1);
check("clean text has no tells", detectAiTells("i just post like i talk").length === 0);
check("finds forbidden topics", detectForbidden("thoughts on crypto markets", ["crypto", "politics"]).includes("crypto"));
check("no false positives", detectForbidden("morning routine post", ["crypto", "politics"]).length === 0);

console.log("\n== PLATFORM FIT + THREADS ==");
const fit = platformCheck("short post", "x");
check("short post fits X", fit.fits);
const long = "word ".repeat(120).trim(); // ~600 chars
const over = platformCheck(long, "x");
check("long post flagged over X limit", !over.fits && over.overBy > 300, `overBy=${over.overBy}`);
const thread = splitThread(long, 280);
check("thread splits into 2-3 posts", thread.length >= 2 && thread.length <= 4, `got ${thread.length} posts`);
check("every thread post fits", thread.every((p) => [...p].length <= 280), thread.map((p) => p.length).join(","));
check("thread numbered", thread.length > 1 && thread[0].startsWith("1/"), thread[0].slice(0, 12));
const linkedFit = platformCheck("x".repeat(2500), "linkedin");
check("linkedin allows long posts", linkedFit.fits || linkedFit.overBy < 100);

console.log("\n== FULL QUALITY GATE ==");
const gate = qualityGate("Here's your caption:\n\nThis game-changer is a total game-changer for crypto fans.", {
  personaName: "Test",
  forbidden: ["crypto"],
  platform: "x",
});
check("gate strips wrapper", !gate.text.startsWith("Here's"));
check("gate scrubs clichés", !gate.text.includes("game-changer"));
check("gate blocks forbidden topic", gate.report.blocked && gate.report.forbidden.includes("crypto"));

const goodGate = qualityGate("i post like i talk. that's the whole trick.", {
  personaName: "Test",
  forbidden: ["crypto"],
  platform: "x",
  posted: [{ content: "i post like i talk. that's the whole trick." }],
});
check("good post not blocked", !goodGate.report.blocked);
check("detects repetition against posted", goodGate.repetition.score > 60, `got ${goodGate.repetition.score}`);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
