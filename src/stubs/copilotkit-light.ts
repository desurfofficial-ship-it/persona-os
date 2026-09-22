/**
 * Compile-weight stubs for the agent page's @copilotkit/react-core graph.
 *
 * react-core statically imports its full UI surface (react-markdown,
 * streamdown, lit web-components, KaTeX via streamdown, the A2UI + MCP-apps
 * renderers, virtualizers). The agent page uses the headless client
 * (CopilotKit provider + useCopilotChat + useCopilotReadable +
 * useCopilotAction) and renders its own cream/charcoal chat pane, so none of
 * those renderer trees are reachable — but bundling them can OOM small
 * preview boxes. resolveAlias in next.config.ts points these specifiers at
 * this module; every symbol below is a benign no-op that throws loudly if a
 * code path ever tries to actually render with it.
 *
 * To restore the full UI: remove the resolveAlias block from next.config.ts.
 */

import type { ReactNode } from "react";

// --- @copilotkit/react-ui ---------------------------------------------------
export function useCopilotChatSuggestions(): void {
  // The prebuilt CopilotChat suggestion hook — unused in the headless agent page.
}

// --- streamdown / react-markdown --------------------------------------------
export function Streamdown(): ReactNode {
  throw new Error("copilotkit-light stub: Streamdown renderer is stubbed out");
}

export function ReactMarkdown(): ReactNode {
  throw new Error("copilotkit-light stub: ReactMarkdown renderer is stubbed out");
}

// --- use-stick-to-bottom ------------------------------------------------------
export function StickToBottom({ children }: { children?: ReactNode }): ReactNode {
  // Pass-through container — only the prebuilt chat used auto-stick scrolling.
  return children ?? null;
}

export function useStickToBottomContext(): { isAtBottom: boolean; scrollToBottom: () => void } {
  return { isAtBottom: true, scrollToBottom: () => {} };
}

// --- @tanstack/react-virtual ---------------------------------------------------
export function useVirtualizer(): { getTotalSize: () => number; getVirtualItems: () => never[] } {
  return { getTotalSize: () => 0, getVirtualItems: () => [] };
}

// --- @copilotkit/web-components/threads-drawer ---------------------------------
export const COPILOTKIT_THREADS_DRAWER_TAG = "copilotkit-threads-drawer-stubbed";

export function defineCopilotKitThreadsDrawer(): void {
  // Real version registers a lit custom element; the headless page never
  // opens the threads drawer, so registration is skipped.
}

// --- @copilotkit/mcp-apps-renderer/activity ------------------------------------
export const MCPAppsActivityType = "mcp_apps_stubbed";

export const MCPAppsActivityContentSchema = {
  safeParse: () => ({ success: false as const }),
  parse: () => {
    throw new Error("copilotkit-light stub: MCP apps activity is stubbed out");
  },
};

export function ɵrunMcpFollowUp(): void {
  throw new Error("copilotkit-light stub: MCP apps activity is stubbed out");
}

// --- @copilotkit/a2ui-renderer ---------------------------------------------------
export const A2UI_SCHEMA_CONTEXT_DESCRIPTION = "A2UI renderer stubbed out";
export const DEFAULT_SURFACE_ID = "stubbed-surface";
export const ROOT_COMPONENT_ID = "stubbed-root";

export function Catalog(): ReactNode {
  throw new Error("copilotkit-light stub: A2UI catalog is stubbed out");
}

export function A2UIProvider({ children }: { children?: ReactNode }): ReactNode {
  // Pass-through: only reachable when an agent streams A2UI surfaces,
  // which the Persona OS agent never does.
  return children ?? null;
}

export function A2UIRenderer(): ReactNode {
  throw new Error("copilotkit-light stub: A2UI renderer is stubbed out");
}

export function viewerTheme(): { name: string } {
  return { name: "stubbed" };
}

export function initializeDefaultCatalog(): void {}
export function buildCatalogContextValue(): { stubbed: true } {
  return { stubbed: true };
}
export function extractCatalogComponentSchemas(): never[] {
  return [];
}
export function filterCatalog<T>(items: T[] | undefined | null): T[] {
  return Array.isArray(items) ? items : [];
}
export function injectStyles(): void {}
export function useA2UIActions(): Record<string, never> {
  return {};
}
export function useA2UIError(): { error: null } {
  return { error: null };
}

// react-markdown's real package also ships a default export.
export default ReactMarkdown;

// v2 index also reads defaultTheme from the a2ui-renderer.
export const defaultTheme = viewerTheme();
