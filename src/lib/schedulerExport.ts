/**
 * Export drafts into formats other schedulers understand.
 * Persona OS generates + tracks; tools like Shoutrrr / Typefully / CSV queues publish.
 */

export interface ExportableDraft {
  id: string;
  content: string;
  type: string;
  planned_for?: string | null;
  created_at: string;
  persona_name?: string;
}

export interface SchedulerPayload {
  exported_at: string;
  source: "persona-os";
  version: 1;
  count: number;
  posts: {
    id: string;
    text: string;
    type: string;
    persona?: string;
    scheduled_at: string | null;
    platforms: string[];
  }[];
}

/** ISO date for plan day at local noon, or null. */
function scheduledAt(d: ExportableDraft): string | null {
  if (!d.planned_for) return null;
  const t = new Date(d.planned_for);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString();
}

export function toSchedulerPayload(
  drafts: ExportableDraft[],
  platforms: string[] = ["x"]
): SchedulerPayload {
  return {
    exported_at: new Date().toISOString(),
    source: "persona-os",
    version: 1,
    count: drafts.length,
    posts: drafts.map((d) => ({
      id: d.id,
      text: d.content,
      type: d.type,
      persona: d.persona_name,
      scheduled_at: scheduledAt(d),
      platforms: [...platforms],
    })),
  };
}

/** CSV: scheduled_at,text,persona,type,id */
export function toSchedulerCsv(drafts: ExportableDraft[]): string {
  const escape = (s: string) => {
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = ["scheduled_at,text,persona,type,id"];
  for (const d of drafts) {
    lines.push(
      [
        scheduledAt(d) || "",
        escape(d.content.replace(/\r\n/g, "\n")),
        escape(d.persona_name || ""),
        d.type,
        d.id,
      ].join(",")
    );
  }
  return lines.join("\n");
}

/** Plain week plan (human + xqueue-style drop files). */
export function toWeekPlanText(drafts: ExportableDraft[], title = "Persona OS queue"): string {
  const lines = [`# ${title}`, `Exported: ${new Date().toISOString()}`, ""];
  drafts.forEach((d, i) => {
    const when = d.planned_for
      ? new Date(d.planned_for).toLocaleString()
      : "unscheduled";
    lines.push(`## ${i + 1} — ${when}${d.persona_name ? ` — ${d.persona_name}` : ""}`);
    lines.push("");
    lines.push(d.content.trim());
    lines.push("");
    lines.push("---");
    lines.push("");
  });
  return lines.join("\n");
}

export function downloadText(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
