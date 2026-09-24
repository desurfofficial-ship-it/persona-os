/**
 * Research-backed viral patterns for captions, scripts, and image prompts.
 * Distilled from 2025–2026 platform analyses (500+ viral short-form samples,
 * retention studies, Midjourney/Flux prompt practice, fold-limit research).
 *
 * Injected into generation strategies — not shown raw to end users.
 */

/** Hook families that consistently earn the second line / second second. */
export const HOOK_FAMILIES = `
HOOK FAMILIES (pick ONE architecture — do not stack all of them):
1. Specific number claim — "I [result] in [time] with [one method]." Specificity creates a fact-check reflex and signals lived experience.
2. Contrarian / "everyone's wrong" — challenge a consensus belief the audience holds, then prove the alternative. Disagreement is friction that stops scrolls.
3. Mistake warning / cost-of-error — "Stop doing X. Here's what it costs." Loss aversion outperforms aspiration in early retention.
4. Curiosity gap / open loop — promise a reveal, deliver it later. Brain hates unclosed questions.
5. Confession / before-after — vulnerability with a clear turning point. Concrete details (time, place, object) beat adjectives.
6. Listicle preamble — "3 signs…" / "The only 2 rules…" Completion bias keeps viewers to the last item.
7. Authority-borrow / time-credential — "After [years/reps], here's the one thing…" Establishes credibility in 3 seconds.
8. Direct callout / identity filter — "If you [specific behavior], this is for you." Concentrates the right audience.
9. Investigator / mystery — "I found the one thing killing your [X] and it's not what you think." Unfolding mystery.
10. Pattern interrupt — start mid-action or mid-sentence; no throat-clearing.

RULES:
- The FIRST LINE must work alone (platform fold truncates the rest).
- Prefer concrete nouns and numbers over adjectives.
- Never invent stats, quotes, or URLs.
- One idea per post. One ask at the end (comment / save / try), not three.
- Emotion hierarchy that moves algorithms (2026 data): Fear > Empathy > Outrage > Curiosity. Pick one dominant register.`;

export const CAPTION_CRAFT = `
CAPTION CRAFT (platform-native, 2026):
Structure: HOOK (line 1, before fold) → BODY (1–3 short beats) → CLOSE (one clear CTA or question).

FOLD RULES (hard):
- Instagram ~125 chars before "more"
- LinkedIn ~210 chars before "see more"
- X/Threads: first line is the entire post for many viewers
- First line must earn the tap. Put punch, number, or tension FIRST.

STYLE:
- Short lines. Blank lines between beats. Scannable in 3 seconds.
- Phone-thumb energy, not brand-desk energy. Sound like they typed it in 60 seconds.
- Second-person or collective "you/we" for shareable lines; first-person for confession.
- Hashtags: only if platform allows; never lead with them; quality > quantity (3–5 max where allowed).
- If Voice DNA shows emoji use, allow sparse emoji as punctuation — never decoration spam.
- End with ONE ask: a specific question, "save this", or a one-word reply prompt.
- Write the feeling, not just the event. "Nobody warns you how quiet it gets after you quit" beats "Quit my job today".
- Cut the last adjective. Plain > clever.`;

export const SCRIPT_CRAFT = `
SHORT-FORM SCRIPT CRAFT (TikTok / Reels / Shorts — 2026 retention research):

GOAL: Maximize early hold (first 1–3s) and completion rate. Algorithms weight watch-through heavily.

STRUCTURE (beat sheet):
HOOK (0–3s) → TENSION / PROMISE → VALUE BEATS (micro-loops every 5–10s) → REWARD / PAYOFF → CTA.

HOOK (spoken + on-screen text, ≤12–14 words, lands in ≤3 seconds):
- Pattern interrupt, specific claim, mistake warning, open loop, or investigator.
- No "Hey guys", no channel intro, no slow zoom on face talking.
- Text overlay must carry the story alone (many watch muted).
- Strongest openers in 2026 data: specific-number claim, contrarian, listicle, investigator, hot take.

MIDDLE (retention engine):
- Micro-loops every 5–10 seconds: "but the third one…", "wait —", "here's the part nobody says".
- One idea per sentence. Spoken contractions. Fast delivery (~200–220 WPM for TikTok/Reels).
- Inline [visual] cues on every beat so the editor knows the cut (pattern interrupt, demo, B-roll, text punch).
- Design for mute: on-screen text should tell the full story without audio.
- Visual change every 2–3 seconds where possible (cut, zoom, prop, overlay).
- Stack micro-payoffs so viewers never feel they can leave early.

CLOSE:
- Deliver the hook's promise (reward the watch) BEFORE the CTA.
- One CTA only (save / comment a word / try this today / follow for part 2).
- Do not introduce new information in the last 3 seconds.

LENGTH TARGETS (platform-tuned):
- TikTok: 15–30s sweet spot (~40–80 words). Fast cuts, raw energy.
- Instagram Reels: 7–15s for pure reach; 15–30s for value. Aesthetic + captions matter.
- YouTube Shorts: 30–45s (~75–110 words). Slightly denser info OK; completion still king.
- Cross-platform default: script core at 30s, then trim or extend.

PACING NOTES:
- TikTok has shortest tolerance — hook in first 1–1.5s.
- Reels rewards polished visual + readable captions.
- Shorts rewards full watches; avoid 50% drop-off at midpoint.
- Never open with story throat-clearing ("So the other day…") — data shows these underperform hard.`;

export const IMAGE_PROMPT_CRAFT = `
IMAGE PROMPT CRAFT (consistent personal-brand visuals — Midjourney / Flux / SD 2026):

GOAL: Paste-ready prompts that lock identity and style across a series while varying only scene/action.

FIXED FIELD ORDER (one flowing paragraph):
1. IDENTITY LOCK — reuse exact visual-style language from persona (age read, hair, wardrobe signature, skin texture cues). Lead with identity; it carries the most weight.
2. SHOT — framing (extreme close-up / close-up / mid / three-quarter / full), camera height/angle, lens feel (35mm / 50mm / 85mm), depth of field.
3. SUBJECT — pose, expression, action, hands (believable), wardrobe details that match persona.
4. SCENE — place, time of day, background, props that belong in their world only. No random clutter.
5. LIGHT — direction (camera-left / window / overhead), quality (soft diffused / golden hour / overcast / Rembrandt), color temperature.
6. COLOR / MOOD — palette words + emotional tone. Keep consistent with persona visual style.
7. REALISM / MEDIUM — natural skin texture, fabric folds, accurate shadows, film stock or camera language if photoreal ("shot on 50mm, medium format, Portra 400"). Prefer editorial / candid photography language over "8k masterpiece trending on artstation".
8. COMPOSITION NOTES — negative space for text overlay if needed, aspect-ratio intent (4:5 feed, 9:16 story, 1:1).
9. AVOID — text, watermarks, logos, extra fingers, waxy/plastic skin, stock-photo smile, busy clutter, deformed hands, oversaturated HDR look.

RULES:
- Lock identity/style language from the persona; only change scene/action per prompt.
- Brand Prompt Prefix pattern: keep a 40–60 word style block identical across a series; vary only the subject/scene clause.
- Prefer photographic language for personal-brand work (Flux especially rewards full natural-language sentences; Midjourney prefers denser aesthetic tokens + parameters).
- One flowing paragraph a Midjourney/Flux user can paste as-is.
- End every prompt with an explicit AVOID: list.
- Leave negative space when the post needs text overlay room.
- For consistency across a campaign: same identity tokens, same lighting vocabulary, same palette, same lens language.

IDENTITY LOCK (reference-faithful, personal-brand series):
- Lead with: "Person with features faithful to the reference / persona visual style" when a face is involved.
- Preserve: facial identity, skin tone, apparent age, body proportions — never "beautify" into a different person.
- Prefer found-memory / documentary / editorial pause over staged glamour.
- Phone-camera or film grain OK when it matches persona; natural imperfections beat plastic perfection.
- AVOID: fantasy neon, carnival costume energy, plastic/waxy skin, stock-photo smile, generic dance-floor tropes, AI artifacts, changed facial features.`



/** Multi-post series / story-arc craft (content calendars, carousels of ideas, week-long threads). */
export const SERIES_CRAFT = `
SERIES / STORY-ARC CRAFT (3-5 posts that feel planned, not random):

GOAL:
- Each post must work ALONE in the feed.
- Together they should feel like one intentional arc a follower can binge.

STRUCTURE OPTIONS (pick ONE for the whole series):
1. SETUP -> TENSION -> PAYOFF -- post 1 plants a problem or claim, middle escalates stakes or cost, final post delivers the turn and loops back to post 1's promise.
2. MYTH -> PROOF -> FRAMEWORK -- post 1 names a common belief, post 2 shows why it fails with a concrete story/number, final posts hand a simple 2-3 step frame.
3. BEFORE -> TURN -> AFTER -- confession arc: who they were, the specific moment that changed, what they do differently now (one habit, not a life lecture).
4. LIST TEASE -> ITEM DEEP-DIVES -- post 1 promises N items; each following post is one item with its own fold-proof hook; final post ranks or gives the "use this first" rule.
5. PROBLEM -> COST -> FIX -> CTA -- classic retention arc split across posts; never dump the whole fix in post 1.

HOOK RULES ACROSS THE SERIES:
- Every post opens with a DIFFERENT hook family (specific number, contrarian, mistake, curiosity, identity callout, list tease).
- No two posts share the same first-line structure.
- First line of each post must survive the platform fold alone.

CONTINUITY WITHOUT SPOILERS:
- Middle posts may soft-reference "yesterday" / "part 2" once -- never depend on it.
- A cold reader who only sees post 3 still gets a complete idea + one CTA.
- Final post pays off the series promise BEFORE its CTA.

CTA RULES:
- One CTA per post, varied: save / comment a word / try this today / reply with your number.
- Do not stack "like + comment + share + follow" on any single post.

OUTPUT FORMAT:
- Label clearly: POST 1: / POST 2: / ...
- Under each: fold-proof first line, 2-4 short body beats, one CTA.
- Plain text only -- no markdown headers.
`;


/** Eden / Dan Koe packaging insight: most posts die in the packaging, not the idea. */
export const PACKAGING_CRAFT = `
PACKAGING CRAFT (steal the structure, not the words):
- Most posts fail in packaging: same idea + weak first line = death in the feed.
- When given a WINNER post: extract the STRUCTURE (hook family, tension shape, payoff timing), never copy phrases.
- Produce a NEW angle with a DIFFERENT hook family than the winner.
- Angle menu (pick one): opposite take | next-step | cost/mistake | identity callout | specific number | list tease | confession micro-story.
- Keep the underlying insight territory; change the entry door.
- First line must survive the platform fold alone.
- Short form: say the essence once. Do not re-summarize the same point three ways (AI slop tell).
`;

/** Platform-tuned length and pacing notes injected into type tasks. */
export const PLATFORM_SCRIPT_NOTES = `
PLATFORM PACING (apply when platform is known):
- TikTok: fastest hook (≤1.5s), raw/unpolished OK, completion + loop rate matter most.
- Instagram Reels: visual polish + readable on-screen text; saves and DM shares are strong signals.
- YouTube Shorts: slightly longer tolerance; information density + full watch rewarded.
- LinkedIn video: authority interrupt + specific data; professional but human.`;
