import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Round-3: the type debt this used to paper over is fully paid —
  // `tsc --noEmit` is clean, so build-time type errors now fail the build
  // like they should (was: ignoreBuildErrors: true).
  typescript: {
    ignoreBuildErrors: false,
  },
  // Re-enabled: catches accidental double-mount bugs in agent/draft flows.
  reactStrictMode: true,
  // Load these natively from node_modules at request time instead of compiling
  // them into the dev bundle — the CopilotKit runtime graph alone was OOM-
  // killing 4GB preview boxes during dev compiles.
  serverExternalPackages: ["@copilotkit/runtime", "z-ai-web-dev-sdk", "openai"],
  // Headless agent page: alias heavy CopilotKit UI deps to light stubs so
  // compile stays under ~4GB. Delete this block to restore the full prebuilt UI.
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
