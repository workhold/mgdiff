import { access, readdir, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

const target = fileURLToPath(new URL("./src-tauri/target/", import.meta.url));
const executable = process.platform === "win32" ? "mgdiff.exe" : "mgdiff";

async function findCliPath(): Promise<string | null> {
  const candidates: string[] = [];
  if (process.platform === "darwin") {
    candidates.push(join(target, "release/bundle/macos/MGDiff.app/Contents/MacOS/mgdiff"));
  } else if (process.platform === "linux") {
    const appImages = await readdir(join(target, "release/bundle/appimage")).catch(() => []);
    candidates.push(...appImages.filter((name) => name.endsWith(".AppImage")).sort().reverse()
      .map((name) => join(target, "release/bundle/appimage", name)));
  }
  candidates.push(join(target, "release", executable), join(target, "debug", executable));
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) {
        await access(path, constants.X_OK);
        return path;
      }
    } catch { /* Try the next build artifact. */ }
  }
  return null;
}

function devCliPathPlugin(): Plugin {
  return {
    name: "mgdiff-dev-cli-path",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "GET" || request.url?.split("?")[0] !== "/__mgdiff/cli-path") {
          next();
          return;
        }
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(JSON.stringify({ path: await findCliPath() }));
      });
    },
  };
}

export default defineConfig(({ command, isPreview }) => ({
  plugins: [react(), ...(command === "serve" && !isPreview ? [devCliPathPlugin()] : [])],
  base: "./",
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1421,
    strictPort: true,
  },
}));
