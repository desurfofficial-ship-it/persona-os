export interface Persona {
  id: string;
  user_id: string;
  name: string;
  backstory: string;
  visual_style: string;
  tone_of_voice: string;
  lifestyle_pillars: string[];
  content_rules: string[];
  forbidden_topics: string[];
  example_posts?: string[];
  created_at: string;
  updated_at: string;
}

export interface Asset {
  id: string;
  persona_id: string;
  type: "image" | "video" | "text" | "metric";
  url?: string;
  content?: string;
  tags: string[];
  created_at: string;
}

export type DraftPerformance = "worked" | "ok" | "flopped";

export interface ContentDraft {
  id: string;
  persona_id: string;
  type: "caption" | "script" | "story_arc" | "image_prompt";
  content: string;
  consistency_score?: number;
  flags?: string[];
  posted?: boolean;
  performance?: DraftPerformance | null;
  created_at: string;
}

export const CONTENT_TYPES = ["caption", "script", "story_arc", "image_prompt", "rewrite"] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
