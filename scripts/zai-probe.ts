/** Direct probe of the z-ai sdk (the preview model's brain) — no CopilotKit layer. */
import ZAI from "z-ai-web-dev-sdk";

async function main() {
  try {
    const zai = await ZAI.create();
    const res = await zai.chat.completions.create({
      messages: [
        { role: "system", content: "You are a terse assistant." },
        { role: "user", content: "Reply with exactly: OK-123" },
      ],
    });
    console.log("chat result:", JSON.stringify(res.choices?.[0]?.message?.content || res).slice(0, 300));
  } catch (err) {
    console.error("ZAI PROBE FAILED:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
main();
