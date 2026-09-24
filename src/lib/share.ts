/**
 * One-tap "Copy & open platform" helpers.
 *
 * Copies the content to the clipboard first, then opens the platform
 * composer in a new tab. X (Twitter) supports text prefill via the
 * intent URL; LinkedIn does not support text prefill, so we copy the
 * text and open the feed/composer directly.
 */

export type Platform = "twitter" | "linkedin" | "instagram" | "threads" | "tiktok" | "youtube_shorts";

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    // Fallback for older / insecure contexts
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function composeUrlFor(platform: Platform): string {
  switch (platform) {
    case "twitter":
      return "https://twitter.com/intent/tweet";
    case "linkedin":
      return "https://www.linkedin.com/feed/";
    case "instagram":
      return "https://www.instagram.com/";
    case "threads":
      return "https://www.threads.net/";
    case "tiktok":
      return "https://www.tiktok.com/upload";
    case "youtube_shorts":
      return "https://studio.youtube.com/";
  }
}

export async function copyAndOpen(
  text: string,
  platform: Platform
): Promise<{ copied: boolean }> {
  const copied = await copyToClipboard(text);

  // Only X supports text prefill; every other platform gets a plain composer.
  const url =
    platform === "twitter"
      ? `https://twitter.com/intent/tweet?text=${encodeURIComponent(
          text.length > 280 ? `${text.slice(0, 277).trimEnd()}...` : text
        )}`
      : composeUrlFor(platform);

  // Open after the clipboard write so mobile Safari/Chrome keep the
  // user-gesture context for both actions.
  window.open(url, "_blank", "noopener,noreferrer");

  return { copied };
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  threads: "Threads",
  tiktok: "TikTok",
  youtube_shorts: "YouTube Shorts",
};
