import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Load these natively from node_modules at request time instead of compiling
  // them into the dev bundle — the CopilotKit runtime graph alone was OOM-
  // killing 4GB preview boxes during dev compiles. (The client-side
  // @copilotkit/react-core still bundles; its page compiles ~3.1GB peak.)
  serverExternalPackages: ["@copilotkit/runtime", "z-ai-web-dev-sdk", "openai"],
  // The agent page uses the headless CopilotKit client, so the heavy renderer
  // trees react-core statically pulls in (react-markdown/streamdown/lit/KaTeX,
  // A2UI + MCP-apps renderers, web-components, virtualizers) are unreachable.
  // Aliasing them to src/stubs/copilotkit-light.ts keeps the dev compile inside
  // 4GB preview boxes; delete this block to restore the full prebuilt UI.
  turbopack: {
    resolveAlias: {
      "@copilotkit/react-ui": "./src/stubs/copilotkit-light.ts",
      "@copilotkit/a2ui-renderer": "./src/stubs/copilotkit-light.ts",
      "@copilotkit/mcp-apps-renderer/activity": "./src/stubs/copilotkit-light.ts",
      "@copilotkit/web-components/threads-drawer": "./src/stubs/copilotkit-light.ts",
      streamdown: "./src/stubs/copilotkit-light.ts",
      "react-markdown": "./src/stubs/copilotkit-light.ts",
      "use-stick-to-bottom": "./src/stubs/copilotkit-light.ts",
      "@tanstack/react-virtual": "./src/stubs/copilotkit-light.ts",
    },
  },
};

export default nextConfig;
