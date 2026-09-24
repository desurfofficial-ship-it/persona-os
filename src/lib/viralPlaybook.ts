/**
 * Research-backed viral patterns for captions, scripts, and image prompts.
 * Distilled from platform fold limits, short-form retention research, and
 * prompt-engineering practice for consistent personal-brand visuals.
 *
 * Injected into generation strategies — not shown raw to end users.
 */

/** Hook families that consistently earn the second line / second second. */
export const HOOK_FAMILIES = `
HOOK FAMILIES (pick ONE architecture — do not stack all of them):
1. Specific number claim — "I [result] in [time] with [one method]." Specificity beats hype.
2. Contrarian / "everyone's wrong" — challenge a common belief, then prove the alternative.
3. Mistake warning — "Stop doing X. Here's what it costs."
4. Curiosity gap / open loop — promise a reveal, deliver it later in the post.
5. Confession / before-after — vulnerability with a clear turning point.
6. Listicle preamble — "3 signs…" / "The only 2 rules…" (completion bias).
7. Authority-borrow — "After [years/reps], here's the one thing…"
8. Direct question — one concrete question that invites a one-word reply.

RULES:
- The FIRST LINE must work alone (platform fold truncates the rest).
- Prefer concrete nouns and numbers over adjectives.
- Never invent stats, quotes, or URLs.
- One idea per post. One ask at the end (comment / save / try), not three.`;

export const CAPTION_CRAFT = `
CAPTION CRAFT (platform-native):
- Structure: HOOK (line 1) → BODY (1–3 short beats) → CLOSE (one clear CTA or question).
- First line must earn the "…more" tap. Put the punch, number, or tension FIRST.
- Short lines. Blank lines between beats. Scannable in 3 seconds.
- Hashtags: only if the platform allows; never lead with them; quality > quantity.
- Sound human: phone-thumb energy, not brand-account energy.
- If Voice DNA shows emoji use, allow sparse emoji as punctuation — never decoration spam.
- End with ONE ask: a specific question, "save this", or a one-word reply prompt.`;

export const SCRIPT_CRAFT = `
SHORT-FORM SCRIPT CRAFT (TikTok / Reels / Shorts retention):
Structure: HOOK (0–3s) → TENSION/PROMISE → VALUE BEATS → REWARD/PAYOFF → CTA.

HOOK (spoken + on-screen text, ≤14 words):
- Pattern interrupt, specific claim, mistake warning, or open loop.
- No "Hey guys" / channel intros. Start mid-thought.

MIDDLE:
- Micro-loops every 5–10 seconds ("but the third one…", "wait —").
- One idea per sentence. Spoken contractions.
- Inline [visual] cues every beat so the editor knows the cut.
- Design for mute: on-screen text should carry the story alone.

CLOSE:
- Deliver the hook's promise (reward the watch) BEFORE the CTA.
- One CTA only (save / comment a word / try this today).

LENGTH:
- Default 30–45 seconds spoken (~75–110 words). Tighter beats beat longer lectures.`;

export const IMAGE_PROMPT_CRAFT = `
IMAGE PROMPT CRAFT (consistent personal-brand visuals):
Use a fixed field order so generators stay controllable:

1. SHOT — framing (close-up / mid / full), camera height, lens feel (35mm / 50mm).
2. SUBJECT — who/what, pose, expression, wardrobe (match persona visual style).
3. SCENE — place, time of day, background, props (only what belongs in their world).
4. LIGHT — direction, quality (soft window / golden hour / overcast), color temperature.
5. COLOR / MOOD — palette words + emotional tone.
6. REALISM — natural skin texture, believable hands, fabric folds, accurate shadows.
7. AVOID — text, watermarks, logos, extra fingers, waxy skin, stock-photo smile, busy clutter.

RULES:
- Lock identity/style language from the persona; only change scene/action per prompt.
- Prefer editorial / candid photography language over "8k masterpiece trending on artstation".
- Leave negative space when the post needs text overlay room.
- One flowing paragraph a Midjourney/Flux/SD user can paste as-is.`;
