import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // The React plugin has to be here as well as in vite.config.ts. Without it
  // tests compile with the classic JSX runtime, so any file using JSX has to
  // keep `React` in scope or fail with "React is not defined" - which is why
  // most specs carry an otherwise unused `import React`.
  plugins: [react()],
  // Belt and braces: the plugin sets this for .tsx, but vitest transforms some
  // files through esbuild directly, so state the runtime explicitly.
  esbuild: { jsx: "automatic" },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/setupTests.ts",
    include: ["src/**/*.{test,spec}.{js,ts,tsx}"],
  },
});
