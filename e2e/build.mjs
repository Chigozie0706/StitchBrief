// Bundles the real app (no Next.js needed) for browser tests. Only `lucide-react` is replaced by trivial SVG stubs.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { build } = await import(process.env.ESBUILD_PATH ?? "esbuild");
const dist = join(root, "e2e", "dist");
mkdirSync(dist, { recursive: true });

const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
const icons = new Set();
for (const f of files(join(root, "src")).filter((f) => /\.tsx?$/.test(f)))
  for (const m of readFileSync(f, "utf8").matchAll(/import\s*\{([^}]+)\}\s*from\s*"lucide-react"/g)) m[1].split(",").forEach((n) => icons.add(n.trim()));
writeFileSync(join(dist, "lucide-stub.jsx"), `const I = (p) => <svg width="1" height="1" aria-hidden="true" {...p} />;\n${[...icons].map((n) => `export const ${n} = I;`).join("\n")}\n`);

await build({
  entryPoints: [join(root, "e2e", "entry.tsx")], outfile: join(dist, "app.js"), bundle: true, format: "iife", jsx: "automatic",
  alias: { "lucide-react": join(dist, "lucide-stub.jsx") }, loader: { ".jsx": "jsx" }, tsconfig: join(root, "tsconfig.json"),
  nodePaths: process.env.E2E_NODE_PATH ? [process.env.E2E_NODE_PATH] : [], define: { "process.env.NODE_ENV": '"development"' }, logLevel: "warning",
});
writeFileSync(join(dist, "app.css"), readFileSync(join(root, "src/app/globals.css"), "utf8").replace('@import "tailwindcss";', ""));
writeFileSync(join(dist, "index.html"), '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
console.log("e2e bundle ready:", dist);
