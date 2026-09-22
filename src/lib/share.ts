/**
 * One-tap "Copy & open platform" helpers.
 *
 * Copies the content to the clipboard first, then opens the platform
 * composer in a new tab. X (Twitter) supports text prefill via the
 * intent URL; LinkedIn does not support text prefill, so we copy the
 * text and open the feed/composer directly.
 */

export type Platform = "twitter" | "linkedin";

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

function twitterIntent(text: string): string {
  // X hard-caps tweets at 280 chars — trim the prefill so nothing is lost.
  const trimmed = text.length > 280 ? `${text.slice(0, 277).trimEnd()}...` : text;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(trimmed)}`;
}

function linkedinComposer(): string {
  return "https://www.linkedin.com/feed/";
}

export async function copyAndOpen(
  text: string,
  platform: Platform
): Promise<{ copied: boolean }> {
  const copied = await copyToClipboard(text);

  const url = platform === "twitter" ? twitterIntent(text) : linkedinComposer();

  // Open after the clipboard write so mobile Safari/Chrome keep the
  // user-gesture context for both actions.
  window.open(url, "_blank", "noopener,noreferrer");

  return { copied };
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  twitter: "X / Twitter",
  linkedin: "LinkedIn",
};
