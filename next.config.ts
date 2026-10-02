import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.env.GITHUB_ACTIONS === "true"
    ? {
        output: "export" as const,
        basePath: "/linkpilot-panel",
      }
    : {}),
};

export default nextConfig;
