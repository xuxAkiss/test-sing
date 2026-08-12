import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const apiProxy = {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
};

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, ".", "");

  return {
    base: environment.VITE_BASE_PATH || "/",
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: apiProxy,
    },
    preview: {
      host: "0.0.0.0",
      port: 4173,
      proxy: apiProxy,
    },
    test: {
      environment: "jsdom",
      setupFiles: "./src/test/setup.ts",
      css: true,
    },
  };
});
