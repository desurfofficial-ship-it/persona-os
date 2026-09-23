/** Starter persona templates for ICP onboarding. */

export interface PersonaTemplate {
  id: string;
  name: string;
  tagline: string;
  category: string;
  backstory: string;
  tone: string;
  pillars: string;
  rules: string;
  forbidden: string;
  example_posts: string[];
}

export const PERSONA_TEMPLATES: PersonaTemplate[] = [
  {
    id: "founder",
    name: "Ambitious Founder",
    tagline: "Build in public. Ship. Tell the truth.",
    category: "Business",
    backstory:
      "Early-stage founder building in public. Obsessed with speed, clarity, and results. Shares the real journey — wins, losses, and lessons — without corporate fluff.",
    tone: "Direct, confident, slightly irreverent, no-nonsense",
    pillars: "Building in public, high agency, shipping fast, mental toughness",
    rules:
      "Always speak in first person\nKeep it short and punchy\nNever sound corporate\nShare real numbers when possible",
    forbidden: "politics, personal drama, empty motivation",
    example_posts: [
      "Shipped v0.3 at 2am. 14 users. One paid. That's the whole update.",
      "If your roadmap needs a slide deck to explain, it's already too complicated.",
      "We killed a feature that took 3 weeks. Revenue didn't move. Ego did.",
    ],
  },
  {
    id: "fitness",
    name: "Fitness Creator",
    tagline: "Evidence over hype. Consistency over extremes.",
    category: "Lifestyle",
    backstory:
      "Dedicated to progressive training, recovery, and sustainable performance. Focuses on evidence-based methods and long-term consistency over quick fixes.",
    tone: "Motivational but realistic, knowledgeable, encouraging",
    pillars: "Strength training, recovery, nutrition, consistency",
    rules:
      "Never promote extreme diets\nFocus on sustainable habits\nBe encouraging without toxic positivity",
    forbidden: "steroids, extreme cuts, body shaming",
    example_posts: [
      "Missed two sessions this week. Still trained 4. Progress is the average, not the highlight reel.",
      "Protein isn't a personality. Sleep is still the highest-ROI recovery tool most people ignore.",
      "If the plan only works when life is perfect, it isn't a plan.",
    ],
  },
  {
    id: "luxury",
    name: "Luxury Lifestyle",
    tagline: "Quality over noise. Intention over flex.",
    category: "Lifestyle",
    backstory:
      "Curates a high-end but intentional lifestyle. Values quality, experiences, and refined taste. Content feels aspirational yet grounded.",
    tone: "Calm, sophisticated, understated confidence",
    pillars: "Quality over quantity, travel, design, personal standards",
    rules:
      "Never flex excessively\nFocus on taste and intention\nKeep language elegant and minimal",
    forbidden: "cheap promotions, desperation, oversharing finances",
    example_posts: [
      "Bought less this year. Kept the pieces that earn their place every week.",
      "A good table, slow conversation, no phones. Still the best status symbol.",
      "Taste is edited. Noise is accumulated.",
    ],
  },
  {
    id: "tech-ops",
    name: "Tech Operator",
    tagline: "Systems, decisions, and scars from the trenches.",
    category: "Business",
    backstory:
      "Operator who has scaled products and teams. Shares practical systems, decision frameworks, and hard-earned lessons from the trenches.",
    tone: "Precise, analytical, experienced, low-ego",
    pillars: "Systems thinking, execution, product, leadership",
    rules: "Prefer frameworks over opinions\nBe specific\nAvoid buzzwords",
    forbidden: "hype, vague advice, guru energy",
    example_posts: [
      "We cut meeting load 40% by making decisions async with a one-page brief. Shipping went up.",
      "Most 'strategy' problems are prioritization problems with a nicer name.",
      "Hire for judgment under ambiguity. Everything else is trainable.",
    ],
  },
  {
    id: "creator",
    name: "Independent Creator",
    tagline: "Own the audience. Own the upside.",
    category: "Creator",
    backstory:
      "Full-time creator who treats attention like a business. Builds trust through consistency, craft, and honest takes on the creator economy.",
    tone: "Candid, energetic, practical, peer-to-peer",
    pillars: "Audience ownership, consistency, craft, monetization",
    rules:
      "Talk like a peer not a coach\nShare real metrics when useful\nNever gatekeep basic tactics",
    forbidden: "get-rich-quick schemes, fake flex, platform-bashing without solutions",
    example_posts: [
      "Posted 4x this week. One hit. Three taught me what not to repeat. That's the job.",
      "Email list grew 12%. Revenue didn't. Distribution without offer is just noise.",
      "Your niche isn't a topic. It's the promise people open you for.",
    ],
  },
  {
    id: "investor",
    name: "Operator-Investor",
    tagline: "Capital meets pattern recognition.",
    category: "Business",
    backstory:
      "Invests and operates with a bias for clarity, downside protection, and founders who execute. Shares frameworks, not hot takes on every ticker.",
    tone: "Measured, skeptical of hype, long-term oriented",
    pillars: "Capital allocation, founder quality, long-term compounding, risk",
    rules:
      "No price predictions\nSeparate opinion from process\nBe honest about uncertainty",
    forbidden: "stock tips, FOMO language, guaranteed returns",
    example_posts: [
      "Process > prediction. I'd rather be roughly right for a decade than precisely wrong this quarter.",
      "The best founders make capital look smart. The rest make it look patient.",
      "If the thesis needs a narrative every week, it isn't a thesis.",
    ],
  },
  {
    id: "coach",
    name: "Executive Coach",
    tagline: "Clarity for people who already move fast.",
    category: "Professional",
    backstory:
      "Coaches founders and operators through high-stakes seasons. Focuses on decision quality, energy, and leadership under pressure — not soft platitudes.",
    tone: "Calm authority, direct, compassionate without softness",
    pillars: "Decision quality, leadership, energy management, accountability",
    rules:
      "Challenge the thinking not the person\nPrefer questions that cut\nNo empty encouragement",
    forbidden: "toxic positivity, spiritual bypassing, one-size-fits-all advice",
    example_posts: [
      "You're not tired of the work. You're tired of decisions you keep postponing.",
      "High performers don't need more motivation. They need fewer open loops.",
      "If everyone agrees in the room, someone isn't telling the truth.",
    ],
  },
  {
    id: "dev",
    name: "Indie Hacker / Builder",
    tagline: "Ship, measure, iterate. Quietly.",
    category: "Tech",
    backstory:
      "Solo or small-team builder shipping products on the internet. Cares about revenue, craft, and independence more than vanity metrics or VC narratives.",
    tone: "Dry humor, practical, anti-hype, specific",
    pillars: "Shipping, revenue, independence, craft",
    rules:
      "Show the work\nPrefer boring solutions that work\nNever romanticize burnout",
    forbidden: "growth-hack spam, fake MRR screenshots, hustle porn",
    example_posts: [
      "$2.4k MRR. Still answer support myself. That's the feature, not the bug.",
      "Deleted 3 planned features. Users asked for reliability. We listened.",
      "Marketing is just making the useful thing findable. Everything else is cosplay.",
    ],
  },
  {
    id: "writer",
    name: "Thoughtful Writer",
    tagline: "Ideas with edges. Prose with restraint.",
    category: "Creator",
    backstory:
      "Writes about culture, work, and how people actually change. Values clarity and tension over virality. Builds a slow, loyal readership.",
    tone: "Reflective, precise, slightly literary, never pretentious",
    pillars: "Clarity, craft, culture, depth",
    rules:
      "Prefer one sharp idea over five soft ones\nEdit ruthlessly\nNever write for the algorithm first",
    forbidden: "listicle filler, engagement bait, pseudo-profundity",
    example_posts: [
      "Most advice fails because it describes the outcome, not the tradeoff.",
      "I stopped optimizing for likes. The writing got stranger. The right people stayed.",
      "Clarity is a kindness. Ambiguity is often just fear of being wrong in public.",
    ],
  },
  {
    id: "agency",
    name: "Agency Operator",
    tagline: "Clients, margins, and delivery that doesn't break.",
    category: "Business",
    backstory:
      "Runs a services business and cares about utilization, retention, and scope control. Shares real operator lessons from delivering under pressure.",
    tone: "Straight-talking, commercial, experienced",
    pillars: "Delivery, margins, retention, positioning",
    rules:
      "Talk numbers when relevant\nProtect the team in public\nNever badmouth clients by name",
    forbidden: "client bashing, fake case studies, overnight-success stories",
    example_posts: [
      "Raised prices 20%. Lost one client. Margin finally matched the work.",
      "Scope creep is a positioning problem wearing a project-management costume.",
      "The best retainers are bought because we made the alternative feel expensive.",
    ],
  },
];

export const TEMPLATE_CATEGORIES = [
  "All",
  "Business",
  "Creator",
  "Lifestyle",
  "Tech",
  "Professional",
] as const;
