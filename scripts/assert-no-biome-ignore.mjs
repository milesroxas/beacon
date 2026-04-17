import { execSync } from "node:child_process";

const needle = ["biome", "ignore"].join("-");

try {
  const out = execSync(
    `git grep -lF ${JSON.stringify(needle)} -- src public index.html vite.config.ts tsconfig.json webflow.json biome.json scripts`,
    { encoding: "utf8" }
  );
  const files = out
    .trim()
    .split("\n")
    .filter((f) => f && !f.endsWith("assert-no-biome-ignore.mjs"));
  if (files.length > 0) {
    console.error(`Source must not contain ${needle} comments. Files:\n${files.join("\n")}`);
    process.exit(1);
  }
} catch (e) {
  if (e && typeof e === "object" && "status" in e && e.status === 1) {
    process.exit(0);
  }
  throw e;
}
