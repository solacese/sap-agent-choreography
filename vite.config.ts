import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/sap-agent-choreography/",
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
    setupFiles: "./src/test/setup.ts",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/application/**/*.ts", "src/domain/**/*.ts"],
      exclude: ["**/* 2.ts", "**/* 2.tsx", "**/*.test.ts", "**/*.test.tsx"],
    },
  },
});
