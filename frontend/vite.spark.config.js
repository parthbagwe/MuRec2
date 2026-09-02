import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react(), {
    name: "cerum-spark-api",
    enforce: "pre",
    resolveId(source, importer) {
      if (importer?.includes("/src/") && /^(\.\/|\.\.\/)api(?:\.js)?$/.test(source)) {
        return fileURLToPath(new URL("./src/spark/api.js", import.meta.url));
      }
    },
  }],
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  build: { outDir: "dist-spark" },
});
