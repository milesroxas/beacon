/// <reference types="vitest/config" />
import fs from "node:fs";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import pkg from "./package.json";

const wfDesignerExtensionPlugin = (): Plugin => {
  let webflowHTML = "";
  const configPath = path.join("./webflow.json");
  const configContent = fs.readFileSync(configPath, "utf-8");
  const webflowConfig = JSON.parse(configContent);

  return {
    name: "wf-vite-extension-plugin",
    transformIndexHtml: {
      order: "pre",
      handler: async (html: string, ctx) => {
        if (ctx.server) {
          console.log("\x1b[36m%s\x1b[0m", "Development mode");
          if (!webflowHTML) {
            const { name, apiVersion } = webflowConfig;
            const template = apiVersion === "2" ? "/template/v2" : "/template";
            const url = `https://webflow-ext.com${template}?name=${name}`;
            webflowHTML = await fetch(url).then((res) => res.text());
          }

          const scriptRegex = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
          let scripts = "";
          let match: RegExpExecArray | null = scriptRegex.exec(webflowHTML);
          while (match !== null) {
            scripts += `${match[0]}\n`;
            match = scriptRegex.exec(webflowHTML);
          }

          const finalHTML = html.replace("</head>", `${scripts}</head>`);
          return finalHTML;
        }
      },
    },

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === "/__webflow") {
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "*",
          });
          res.end(fs.readFileSync(configPath, "utf-8"));
        } else {
          next();
        }
      });
    },
  };
};

/** Force @jsquash/avif to use the single-thread encoder so the build never pulls avif_enc_mt (+ workers). */
const jsquashAvifSingleThread = (): Plugin => ({
  name: "jsquash-avif-single-thread",
  enforce: "pre",
  resolveId(id, importer) {
    const enc = path.resolve(__dirname, "node_modules/@jsquash/avif/codec/enc/avif_enc.js");
    const idN = id.replace(/\\/g, "/");
    const impN = importer?.replace(/\\/g, "/") ?? "";
    if (impN.includes("@jsquash/avif/encode.js") && idN.endsWith("codec/enc/avif_enc_mt.js")) {
      return enc;
    }
    if (idN.includes("@jsquash/avif/codec/enc/avif_enc_mt.js")) {
      return enc;
    }
    return undefined;
  },
});

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [tailwindcss(), react(), wfDesignerExtensionPlugin(), jsquashAvifSingleThread()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_CHANNEL__: JSON.stringify(mode),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "wasm-feature-detect": path.resolve(__dirname, "./src/shims/wasm-feature-detect.ts"),
    },
  },
  server: {
    port: 1337,
    watch: {
      usePolling: true,
    },
  },
  /** Prebundling strips sibling `avif_enc.wasm`; without it, fetches hit the SPA fallback (HTML) and WASM fails. */
  optimizeDeps: {
    exclude: ["@jsquash/avif"],
  },
  build: {
    outDir: "dist",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "bundle.js",
        assetFileNames: (assetInfo: { name?: string | undefined }) =>
          assetInfo.name?.endsWith(".css") ? "styles.css" : "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "node",
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/__tests__/**", "**/vite-env.d.ts"],
    },
  },
}));
