"use client";

import Link from "next/link";

/**
 * Fair-use pricing — priced for creators who post, not agencies who spam.
 * The copy states what we won't build (engagement farming, fake metrics)
 * because that IS the positioning.
 */

const TIERS = [
  {
    name: "Solo",
    price: "$0",
    cadence: "free forever",
    tagline: "One voice, kept consistent.",
    features: [
      "1 persona",
      "20 generations / month",
      "Consistency checker",
      "Drafts + Mark Posted",
      "Export your data any time",
    ],
    cta: "Start free",
    href: "/login",
    highlight: false,
  },
  {
    name: "Creator",
    price: "$19",
    cadence: "per month",
    tagline: "The full consistency loop.",
    features: [
      "3 personas with active-voice switching",
      "Unlimited generations (fair use)",
      "Asset Vault with auto-tags",
      "Write-for-this-asset generation",
      "Week planner + patterns",
      "Posted-aware repeat protection",
    ],
    cta: "Start 14-day trial",
    href: "/login",
    highlight: true,
  },
  {
    name: "Studio",
    price: "$49",
    cadence: "per month",
    tagline: "Founders with a content pod.",
    features: [
      "Everything in Creator",
      "10 personas",
      "Series planning across voices",
      "Priority generation queue",
      "Team seats (coming soon)",
    ],
    cta: "Talk to us",
    href: "mailto:hello@persona-os.app",
    highlight: false,
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-5xl mx-auto px-4 sm:px-8 py-16">
        <div className="text-center mb-14">
          <Link href="/" className="text-sm text-zinc-500 hover:text-white">
            ← Persona OS
          </Link>
          <h1 className="text-4xl sm:text-5xl font-bold mt-6 mb-4">
            Priced for people who post.
          </h1>
          <p className="text-zinc-400 max-w-2xl mx-auto">
            Fair use, fine print in plain sight: your quota resets monthly and doesn&apos;t roll
            over. We don&apos;t sell your data. And we will never build fake-metric dashboards or
            engagement-farming bots — that&apos;s the line this product stands on.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
              className={`rounded-2xl p-7 flex flex-col ${
                tier.highlight
                  ? "bg-white text-black border-2 border-white"
                  : "bg-zinc-950 border border-zinc-800"
              }`}
            >
              {tier.highlight && (
                <span className="text-[10px] uppercase tracking-widest mb-3 text-zinc-500">
                  Most creators pick this
                </span>
              )}
              <h2 className="text-xl font-bold mb-1">{tier.name}</h2>
              <p className={`text-sm mb-5 ${tier.highlight ? "text-zinc-600" : "text-zinc-400"}`}>
                {tier.tagline}
              </p>
              <p className="mb-6">
                <span className="text-4xl font-bold">{tier.price}</span>{" "}
                <span className={`text-sm ${tier.highlight ? "text-zinc-600" : "text-zinc-500"}`}>
                  {tier.cadence}
                </span>
              </p>
              <ul className="space-y-2.5 text-sm mb-8 flex-1">
                {tier.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className={tier.highlight ? "text-green-600" : "text-green-400"}>✓</span>
                    <span className={tier.highlight ? "text-zinc-800" : "text-zinc-300"}>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={tier.href}
                className={`block text-center min-h-[48px] leading-[48px] rounded-xl font-semibold text-sm ${
                  tier.highlight
                    ? "bg-black text-white hover:bg-zinc-800"
                    : "bg-white text-black hover:bg-zinc-200"
                }`}
              >
                {tier.cta}
              </Link>
            </div>
          ))}
        </div>

        <div className="bg-zinc-950 border border-zinc-800 rounded-2xl p-8 max-w-3xl mx-auto">
          <h2 className="font-bold mb-4">The fair-use line, in plain words</h2>
          <ul className="space-y-3 text-sm text-zinc-300">
            <li>
              <span className="text-white font-medium">Unlimited means normal human posting.</span>{" "}
              If you&apos;re routing an agency&apos;s entire client roster through one account,
              that&apos;s not the product — we&apos;ll ask you to move to Studio.
            </li>
            <li>
              <span className="text-white font-medium">Your drafts are yours.</span> Export is
              one click, always, on every plan — including free. No lock-in games.
            </li>
            <li>
              <span className="text-white font-medium">No deceptive features, at any price.</span>{" "}
              No fake engagement dashboards, no bot comments, no impersonation of real people.
              Consistency for your own voice, nothing shadier than that.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
