// Persona OS — Round 4 & 5 Red-Team Report content module
// All text is plain-ASCII English. No markdown artifacts.

const meta = {
  title: "Persona OS Red-Team Report",
  subtitle: "Round 4: Ten Break-Fix-Harden Cycles \u00b7 Consolidated Fix Sprint \u00b7 Round 5: Five Fresh Cycles",
  englishLabel: "PERSONA OS",
  metaLines: [
    "Product: Persona OS - the content consistency operating system",
    "Prepared by: Technical Co-founder (AI engineering lead)",
    "Audience: CEO / Product Council - internal working document",
    "Date: September 22, 2026",
    "Classification: Internal - Confidential",
  ],
  footerLeft: "desurfofficial / persona-os",
  footerRight: "September 2026",
  headerText: "Persona OS Red-Team Report - Rounds 4-5",
};

const execSummary = [
  "This dossier applies the established red-team loop - break the product, fix it, harden the fix, then rewrite the ideal customer profile (ICP) verdict covering what the ICP loves, what it hates, and what it wants improved next - across fifteen fresh attack cycles. Round 4 runs ten cycles against the product as it exists today (v0.4, after the Round 3 execution shipped the Start-here first-run wizard, posted-aware generation, one-tap Copy and Open, Make-all-formats, and the mobile fast-post polish). Round 5 then starts over from five attack classes that earlier rounds never touched: positioning, authenticity and legal exposure, analytics integrity, platform risk, and the team's own execution capacity.",
  "The method per cycle is fixed. Each cycle states the sharpest available attack on one assumption, the smallest fix that survives the attack, the hardening that prevents regressions and edge-case abuse, and a rewritten ICP feedback block. ICP feedback is a written synthesis of the Round 2 panel voice - founder-creators posting three or more times per week on X and LinkedIn - and is illustrative rather than measured data. It is used to rank the fix backlog, not to report facts.",
  "Three themes dominate the fifteen cycles. First, the system still only sees what users type into it: voice quality depends on sample size (Cycle 1), consistency drifts outside the app (Cycle 4), and performance knowledge stays trapped in the user's memory (Cycle 13). Second, the product accidentally punishes both success and real life: posted-awareness suppresses proven winners (Cycle 3), series break under missed days (Cycle 5), and a week-three absence converts directly into churn (Cycle 10). Third, trust and economics have become product features rather than back-office concerns: inference costs must be routed by model tier (Cycle 8), and a privacy guarantee must ship before the next growth push (Cycle 9).",
  "The consolidated Fix Sprint ranks seven fixes into two two-week sprints, defers five temptations with explicit reasons, and closes with a 30-day plan carrying kill criteria per feature. The sharpened positioning line that survives all fifteen attacks is: Persona OS is your voice, systematized - so you never sound off-brand when you post.",
];

const startingState = [
  "Version 0.4 is the product after the Round 3 execution, and every attack in this dossier assumes it as the baseline. The first-run path is a single wizard at /dashboard/start: paste three to ten posts, watch the analyzer build the persona, review it, and land directly on the generate screen with a first-run banner. New accounts see a Start-here hero instead of a menu of features, and the navigation is reduced to Dashboard, Generate, and Drafts with everything else under a More dropdown.",
  "Posted-awareness is live: the generator receives the twenty most recent posted items per persona as context, injects an avoiding-repeats block into the system prompt, and shows a live amber duplicate warning with a Low, Medium, or High sensitivity setting persisted per user. One-tap Copy and Open is shipped through an intent-URL composer on X with a 280-character prefill and a LinkedIn feed fallback, and Make-all-formats converts any result into a script, a caption, and an image prompt in one sequence. Mobile carries a sticky Generate bar, fifty-two-pixel minimum primary buttons, and a weekly momentum strip on the dashboard showing drafts, posted counts, a day streak, and weekly-goal progress.",
  "This baseline is genuinely good - the Round 2 ICP priority list was fully shipped and verified in the browser. The purpose of Round 4 is to attack what that list left out: the quality of the voice model behind the fast first-run, the honesty of the consistency promise, the economics and trust posture underneath the surface, and the behavior of the system when real life interrupts the streak.",
];

const fixSprintIntro = [
  "The ten Round 4 ICP verdicts were consolidated by frequency multiplied by pain: a request repeated across cycles and blocking daily usage ranks above a request that is loud but situational. The result is seven fixes in priority order, mapped to two two-week sprints. The ranking deliberately promotes the import flow - the paste tax is the only request that appeared verbatim in four separate cycles - and promotes the trust stack ahead of growth features, because every other promise in this report assumes the user believes the product protects them.",
];
const fixSprintTable = {
  intro: "Table 1: Consolidated Fix Sprint - seven fixes ranked by ICP frequency and pain.",
  headers: ["No.", "Fix", "Origin", "Sprint", "Why it wins"],
  widths: [6, 26, 14, 12, 42],
  rows: [
    ["1", "X / LinkedIn read-only import of recent posts", "Cycles 1, 4", "Sprint 1", "Kills the paste tax - the single most repeated ICP request across all ten cycles"],
    ["2", "Week calendar view (planned vs posted, one-tap write for tomorrow)", "Cycle 5", "Sprint 1", "Makes the product a home for the week, not just a generator of moments"],
    ["3", "Persona switcher, up to three, with active-voice badge", "Cycle 7", "Sprint 1", "Real founders run two voices; one-voice assumptions corrupt output quality"],
    ["4", "Trust page, no-training guarantee, export and delete everything", "Cycle 9", "Sprint 1", "Ships the differentiator generic AI tools cannot copy, before growth spend"],
    ["5", "Vault-to-Generate loop with automatic asset tags", "Cycle 6", "Sprint 2", "Converts the asset graveyard into the launchpad for image-led posts"],
    ["6", "Welcome-back flow with absence-as-content re-entry", "Cycle 10", "Sprint 2", "Attacks the week-three churn driver directly instead of watching it happen"],
    ["7", "Performance self-rating plus paste-notifications parser", "Cycles 3, 13", "Sprint 2", "Feeds the remix engine with real winners; turns memory into data"],
  ],
};
const fixSprintDecisions = [
  { label: "Deferred - native posting API", text: "moved to the quarter after next. Platform approval cycles are slow, and the incremental gain over the one-click composer and share sheet is small today. Revisit once the ICP is posting daily through the current path." },
  { label: "Deferred - Notion and Google Docs export", text: "queued behind Persona Export v1 in the quarter after next. Structured document export matters to a minority of the panel and competes for the same sprint capacity as the vault loop." },
  { label: "Deferred - OCR for screenshots and metrics CSV import", text: "parked for the next quarter. Useful, but the manual rating plus paste-notifications parser delivers most of the pattern-insight value at a fraction of the engineering cost." },
  { label: "Deferred - SOC 2 certification", text: "set as a pre-scale milestone. The trust page, the row-level-security audit, and the incident-response plan ship first because they change user behavior now, while certification changes procurement conversations later." },
  { label: "Deferred - team seats and shared workspaces", text: "post-revenue. The three-persona switcher covers the verified two-voices use case without importing multi-tenant complexity." },
];

const conclusions = [
  "After ten break-fix-harden cycles, a consolidated fix sprint, and five fresh cycles, the product definition for version 0.5 is stable. The loop becomes: import recent posts with zero friction, confirm a voice-confidence score, generate with fire/flop remix awareness and drift guardrails, post through a one-tap share or composer path, see the week on a calendar, launch image-led posts from the vault, receive one honest pattern insight, and be welcomed back without guilt after any gap. The moat is the memory layer that lives outside every platform - persona rules, drift history, performance tags, and the vault - and the positioning is the line that survived every attack: your voice, systematized, so you never sound off-brand when you post.",
  "Execution is now scheduled as two two-week sprints with kill criteria agreed before building, so that failure of a feature is a cheap, fast decision instead of a debate. Sprint 1 carries the import flow, the week calendar, the persona switcher, and the trust page. Sprint 2 carries the vault loop with automatic tagging, the welcome-back flow, pattern insights v1, and the fair-use pricing page. The Friday ship ritual continues: one user-visible improvement and a public changelog entry every week, which the ICP reads as trust through shipped work.",
];

const killCriteria = [
  "Import: if fewer than 40 percent of new users complete the read-only import within two weeks of launch, simplify the flow to a single handle-paste step and retest before adding any other onboarding surface.",
  "Week calendar: if calendar sessions lift returning-user activity by less than 5 percent over the baseline week, merge the calendar into the drafts list and stop maintaining a separate view.",
  "Persona switcher: if fewer than 10 percent of accounts with two or more personas use the switcher in the first month, keep it shipped but freeze further investment in multi-persona work.",
  "Welcome-back flow: if fewer than 25 percent of users returning after a seven-day gap take any re-entry path, reduce the surface to the weekly email digest and redirect engineering to the remix engine.",
];

const nextRound = [
  "Once Sprints 1 and 2 ship, the next red-team round should attack the new surface rather than repeat old ground: the quality and honesty of imported voice samples, calendar engagement without pressure, the clarity of the trust page to a first-time reader, and whether pattern insights actually change what the ICP posts next. The ICP panel voice should also be re-benchmarked against real usage data at that point, replacing the synthesis method used in this dossier with measured verdicts.",
];

const cycles = [
  {
    n: 1,
    title: "The Thin-Sample Persona",
    brk: "The onboarding wizard celebrates speed: paste three posts, get a persona in twenty seconds, generate immediately. But a voice model built on three posts is a sketch, not a voice. The first output is roughly eighty percent right and oddly flat - and flat is fatal, because the user concludes it does not sound like them inside week one, at the exact moment churn is cheapest. The Round 3 flow optimized time-to-first-draft; it never measured time-to-credible-voice.",
    fix: "Introduce a Voice Confidence score from 0 to 100 percent, computed from sample size, variety, and length. Below 60 percent the persona is explicitly labeled a draft voice, and every generation carries one honest line: voice at 47 percent - paste three more posts or answer five questions to strengthen. Add a guided interview mode with six questions only a human can answer, such as which take in your niche you are tired of hearing, and fold the answers into the persona rules.",
    harden: "Deduplicate pasted reposts with a similarity check before they inflate the sample, detect language mixing and warn the user, and flag pasted content that does not read as the user - a borrowed thread must be excluded with one tap so outside voices never contaminate the model.",
    love: "The confidence meter - for the first time the product tells the truth about when the persona is actually ready.",
    hate: "Paste is still manual labor; rebuilding a posting history by hand is tedious.",
    want: "One-click read-only import from X or LinkedIn instead of copy-pasting.",
  },
  {
    n: 2,
    title: "Copy and Open Is Not One Click on iOS",
    brk: "On desktop, the intent-URL composer is genuinely one click and the ICP loves it. On iOS the story inverts: X ignores prefilled text from browser intents, the share sheet adds a hop, and switching apps drops mental context - so drafts get abandoned mid-post. The last mile that Round 3 built still leaks exactly where most posting actually happens, which is on phones, in stolen minutes between meetings.",
    fix: "Make the native share sheet the primary mobile path through navigator.share with the composed text, keep the intent-URL composer on web and desktop, and keep the clipboard as the fallback with a pasted confirmation that offers mark-as-posted. For threads, stage the parts: the moment the user returns from posting part one, part two is already on the clipboard.",
    harden: "Fall back automatically when text exceeds intent-URL limits of roughly two thousand characters; route LinkedIn through the share sheet only, since it has no composer intent; and autosave every draft before any app switch so nothing is ever lost mid-post.",
    love: "The desktop one-click composer - it feels like the product ends at the front door of the platform.",
    hate: "iOS still takes three taps, and the app jump loses momentum.",
    want: "Real posting integration, or scheduled posting-time nudges with the draft pre-loaded.",
  },
  {
    n: 3,
    title: "Posted-Awareness Accidentally Bans Your Winners",
    brk: "Round 3 shipped posted-aware generation: the system avoids topics the user has already posted. That optimizes for novelty - and quietly bans the user's best material. Creators rebuild proven winners constantly; a growth-minded founder wants the winning angle again in fresh packaging. As shipped, the more successful a post was, the harder the system avoids repeating it. The feature protects against repetition of exactly what works.",
    fix: "Add a one-tap performance tag when a draft is marked posted: fire, fine, or flop, all optional. Fire posts become remix candidates - the engine proposes the same angle with a new example and a new hook, and shows how close the remix is to the original. Flops get avoided harder than before. The existing Low, Medium, High sensitivity slider now governs both duplicate warnings and remix distance.",
    harden: "Cap the remix rate for users who tag everything fire, and always show the reasoning behind a remix proposal; when no performance data exists, fall back to angle rotation - the same topic may return after fourteen days only with a new angle.",
    love: "Winners become a content source instead of a dead zone.",
    hate: "Self-reporting performance is one more chore stacked on top of posting.",
    want: "A paste-your-notifications flow that extracts what performed automatically.",
  },
  {
    n: 4,
    title: "The Consistency Engine Only Sees What Is Typed Into Persona OS",
    brk: "The core promise is never break character, but the checker only sees what is typed into the product. Most real posting happens natively in X and LinkedIn with no engine in the loop. One off-persona rant posted directly to the timeline and the public persona drifts anyway - while the dashboard keeps showing a clean score. The central claim quietly fails in the field, and worse, the user cannot even see it failing.",
    fix: "Ship the Drift Log: a thirty-second end-of-day ritual where the user pastes anything they posted elsewhere; the checker scores it, logs the drift, and proposes rule updates, for example that VC takes have drifted in twice this week and should become a forbidden topic. The dashboard gains a weekly Persona Health score with a trend line, so consistency becomes a visible number that can move in the right direction.",
    harden: "If the ritual is skipped for five or more days, send a weekly digest covering the three topics where drafts drifted most; frame drift as trending drift, never as failure or shame, so the ritual survives contact with a bad week.",
    love: "Persona Health - consistency is finally a number, and it moves.",
    hate: "Manual logging is a tax on honesty.",
    want: "Read-only auto-ingest of the X timeline so the drift log fills itself.",
  },
  {
    n: 5,
    title: "Series Assume You Never Miss a Day",
    brk: "Three, five, and seven-day series are streaks in disguise. The ICP is a founder with a real job: miss one day, feel guilt, skip two more, archive the series, and conclude that the system is for people with time. Streak-based products die for people with lives - and the series planner, as built, is a streak generator with extra steps and red badges.",
    fix: "Introduce Catch-up Mode. Mark a day as skipped and the planner re-sequences the remaining posts, shifts the dates, and offers a generated bridge post - got pulled into a launch, here is what it taught me - that keeps the arc alive. A series becomes a flexible arc rather than a streak, and every red missed-day badge is removed from the interface.",
    harden: "Three or more consecutive skips auto-pause the series with a one-tap revive; completion is celebrated explicitly; and no failure counts or cumulative miss statistics are displayed anywhere, ever.",
    love: "Finished a first-ever series without rearranging life around it.",
    hate: "Still cannot see the whole week at a glance.",
    want: "A simple week calendar view with planned and posted days.",
  },
  {
    n: 6,
    title: "The Asset Vault Is a Graveyard",
    brk: "Users upload photos, tag them, and nothing happens next. Generation is text-only and never touches the vault, and the persona's visual style field is a dead input. A private library with no loop back into creation is a storage sink users forget exists - and a silent churn signal, because the vault was one of the original promises of the product.",
    fix: "Ship Post from Vault. The user picks an asset, and generation uses the persona plus the asset's tags - location, mood, campaign - as prompt context to produce three caption options, alt text, and an optional style-matched image-edit prompt. Tagging suddenly has a payoff, and the vault becomes the launchpad for image-led posts instead of a folder the user scrolls once.",
    harden: "Hash-dedupe uploads to protect storage economics; keep per-asset privacy toggles enforced by row-level security; and auto-suggest tags from file metadata so the manual tagging effort trends toward zero.",
    love: "The vault finally talks to the writer.",
    hate: "Manual tagging after every upload.",
    want: "Automatic tags from EXIF location and image-model mood detection.",
  },
  {
    n: 7,
    title: "Real Founders Have Two Voices, Not One",
    brk: "Real founders run two voices - personal and company - and the product assumes one. If switching personas is heavy, users cram both into a single persona, the rules muddy each other, outputs feel subtly off, and the verdict becomes it does not work. The scope excludes enterprise multi-persona features, but two or three personas is not enterprise - it is Tuesday for this ICP.",
    fix: "Ship a lightweight persona switcher capped at three: a persistent switcher in the header, an active-persona badge on every generation surface, and per-persona draft filters plus an all view. No teams, no sharing, no roles - just clean switching between the voices a founder actually has.",
    harden: "Add a cross-contamination guard: if the active persona changed within the last sixty seconds, generation asks a one-line confirmation that the right voice is active, so company rules never leak into a personal post or the reverse.",
    love: "The badge - always knowing which voice they are in.",
    hate: "The three-persona cap feels arbitrary.",
    want: "Five personas now, and a shared seat for a virtual assistant later.",
  },
  {
    n: 8,
    title: "The Economics Break Before the Product Does",
    brk: "Every generate, strengthen, and check is a paid model call, and a power user generating thirty variations a day is expensive. With flat unlimited pricing, margins invert at exactly the moment the product works - success becomes the risk. This attack touches no screen and no flow; it attacks whether the product can afford its own best users, and it is the attack founders most often discover too late.",
    fix: "Route models by task: a fast, cheap model for check, ideas, and titles, and the premium model only for generate and strengthen. Cache each persona's extracted voice summary once and reuse it across generations instead of re-reading the sample on every call. Present usage as a soft fair-use power meter - gentle slowdown past the ninety-fifth percentile of usage, never a lockout, and never a visible running meter.",
    harden: "Rate-limit regenerate spam with a progressive cooldown; degrade gracefully so the consistency check always works even in slow mode; and reset monthly with no lost work and no lost drafts.",
    love: "Flat, predictable pricing with no meter anxiety.",
    hate: "Any visible credits framing - it feels like a taxi meter.",
    want: "An annual plan and a plain-English page explaining what fair use means.",
  },
  {
    n: 9,
    title: "One Privacy Scare Ends the Company",
    brk: "Users paste their best content, private drafts, and backstories - including sensitive lifestyle pillars and forbidden topics. A single breach, a vague clause about data training, or one careless feature demo ends the company, because trust is the product. A generic writing tool can survive a privacy scare; a tool whose entire job is protecting your voice cannot.",
    fix: "Ship the trust stack before the next growth push: a plain-English page describing exactly who sees the user's content; an explicit no-training guarantee; real, tested export-everything and delete-everything buttons; offline-first autosave for drafts; and a documented row-level-security audit across every table, so per-persona isolation is a verifiable fact rather than a claim.",
    harden: "Put every published privacy claim through legal review before it ships; write the incident-response plan before the incident; commission a third-party penetration test before one thousand users; and enforce least-privilege access with audit logs for anyone who touches production data.",
    love: "The sentence your voice never becomes our training data - the differentiator generic AI tools cannot copy.",
    hate: "Nothing - this is table stakes they expected from day one.",
    want: "SOC 2 later, and a visible statement of where data is processed.",
  },
  {
    n: 10,
    title: "Week Three: The User Stops Posting, Not the Product",
    brk: "The real churn driver is not product quality - it is life. A founder gets slammed, stops posting for ten days, returns to stale drafts and implied guilt, and closes the tab. Every system shipped so far assumes continuous posting; nothing handles re-entry. Churn does not look like an angry cancellation; it looks like a quiet tab that never reopens, and none of the current screens see it coming.",
    fix: "Build the Welcome-back flow. Detect a gap of seven days or more, show zero guilt, and offer three re-entry paths: resurrect a draft; answer the question of what happened this week, turning the absence itself into content; or pull a fresh idea from the niche's current conversation. Absence-as-content is the emotional unlock - the chaotic week becomes the best post.",
    harden: "After repeated long gaps, shift the profile to ideas-only mode so series pressure disappears entirely; celebrate returns explicitly; and never show a days-missed counter anywhere in the product.",
    love: "The chaotic week becoming the best post - the emotional peak of the product so far.",
    hate: "Anything that smells like streak pressure.",
    want: "A gentle weekly email with three ready-to-go ideas.",
  },
];

const cycles5 = [
  {
    n: 11,
    title: "Positioning Attracts Tourists, Not Builders",
    brk: "The phrase content consistency OS reads like infrastructure, and the landing page converts two very different visitors: founders who already post - the right ICP - and AI-tool tourists who want magic with zero effort. Tourists churn in about six days, poison activation metrics, and drown the feedback loop with noise. Messaging here is not a copy problem; it is an admission-control problem.",
    fix: "Rewrite the promise around the job to be done: your voice, systematized - never sound off-brand when you post. Add one onboarding qualifier asking whether the user posts or wants to post weekly, and route tourists to the free tier without pretense. Lead the landing page with founder case studies, and measure activation as persona-created plus first-post-marked, never as signups.",
    harden: "Run an A/B test of two headlines with kill criteria defined in advance - if activation stays below 25 percent after two weeks, revert - and require real posted-work examples before any testimonial goes live.",
    love: "The product finally gets that consistency is not frequency.",
    hate: "Nothing on the words themselves - but words need proof.",
    want: "Real founder case studies instead of testimonials.",
  },
  {
    n: 12,
    title: "Claimed Lifestyle Pillars Sits Next to Fake-It Culture",
    brk: "The spec says claimed lifestyle pillars, which sits one step from fake-it culture. The moment one user fabricates a life with the product's help and gets called out publicly, the product is named in the scandal. Meanwhile disclosure law is tightening - FTC enforcement and the EU AI Act both reach synthetic content - so an AI-generated persona carries legal weight it did not carry two years ago. One viral thread away from the app that fakes founders is a certainty, not a risk, if nothing is built.",
    fix: "Ship Authenticity Mode, default on. Persona pillars are framed as focus zones - aspirationally true, never fabricated. The generation engine refuses specific false claims such as fake jets, fake exits, and fake metrics, and synthetic image prompts are flagged with a one-tap disclosure snippet. A fabrication check now runs beside the consistency check on every output.",
    harden: "Reject prompt patterns that manufacture credentials or metrics screenshots; provide an override path that is annoying but possible, with explicit user confirmation that the claim is true; and publish the policy page in plain English.",
    love: "Authenticity mode protects their reputation too - they are the ones who would get canceled.",
    hate: "Occasional overblocking - my life is genuinely this interesting.",
    want: "An override that makes them confirm out loud that the claim is true.",
  },
  {
    n: 13,
    title: "Analytics Is Half-Built and Knows It",
    brk: "The scope promises to track which persona content performs, but without platform APIs, performance equals user memory - garbage in, vanity out. A half-built analytics tab is worse than none: the moment a user catches one wrong number, they distrust every number, including the consistency scores that are the core promise. This is the attack that quietly kills trust in the whole dashboard.",
    fix: "Shrink analytics to one number that matters. Each draft gets a one-tap rating from one to five after posting, plus optional paste-metrics where the user pastes the notification text and a parser extracts impressions and likes. The product shows a single insight surface with the top three patterns - for example, build-in-public posts rating twice as high. No vanity charts until platform data exists.",
    harden: "When the parser fails, fall back to manual rating without complaint; data entry never blocks the posting flow; and insights stay silent until at least five rated posts exist, so the product never speaks without a sample.",
    love: "A real pattern insight extracted from even sloppy data.",
    hate: "Entering data at all.",
    want: "An X analytics CSV import as a bridge until native data exists.",
  },
  {
    n: 14,
    title: "Platforms Will Ship Write-Like-Me Natively - Then What",
    brk: "X ships Grok, LinkedIn ships AI assists, and every editor is adding write-like-me features. Within twelve months, good-enough persona writing lives inside the platforms - free, native, zero setup. Anything Persona OS does that stays inside one composer gets absorbed. The attack question is brutal, and it should be asked every quarter: after the platforms ship this, why does the product exist?",
    fix: "The moat is the memory layer that lives outside any platform: persona rules, the drift log, fire and flop history, posted-awareness, and the vault compound over time and travel across platforms. Ship Persona Export v1 - the complete voice as a portable system prompt with rules and examples, usable in any AI tool. The paradox is the strategy: portability builds the trust that keeps users inside the system.",
    harden: "Make the export genuinely usable on day one by testing it against three external tools; and keep the system features - series, drift, vault - visibly ahead of pure text generation in the roadmap, so the compounding value stays the reason to return.",
    love: "I can take my voice anywhere - and I still come back for the system.",
    hate: "The fear that export equals churn - unfounded, but real until they try it.",
    want: "Notion and Google Docs export next in line.",
  },
  {
    n: 15,
    title: "Fifteen Cycles of Fixes Equals a Bloated Roadmap",
    brk: "Fifteen cycles of fixes have stacked up: import, calendar, vault loop, switcher, trust page, welcome-back, authenticity mode, pattern insights, fair-use pricing, persona export. A two-person team with no scope discipline ships none of it fast. At this stage the sharpest attack on the product is the roadmap itself - execution risk is now bigger than product risk, and the founder's own operations are the single point of failure.",
    fix: "Cut ruthlessly into a 30-day plan. Sprint 1, days one to fourteen: X and LinkedIn import, week calendar, persona switcher, trust page. Sprint 2, days fifteen to thirty: vault loop with auto-tags, welcome-back flow, pattern insights v1, fair-use pricing page. Everything else gets an explicit parked date rather than a someday. Institute a Friday ship ritual: one user-visible improvement and a public changelog entry every week.",
    harden: "Write kill criteria per feature before building, so failure is a cheap decision instead of a debate; anything not on the 30-day list is parked with a date, not a hope; and the Friday changelog doubles as public accountability for velocity.",
    love: "Watching the roadmap move every single week - trust through shipped work.",
    hate: "Nothing yet - but they will if velocity slips.",
    want: "A public board where they can vote on the next feature.",
  },
];

module.exports = {
  meta, execSummary, startingState, fixSprintIntro, fixSprintTable,
  fixSprintDecisions, conclusions, killCriteria, nextRound, cycles, cycles5,
};
