import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "scripts", "test", "config"];
const forbidden = [/from ["'](?:ruflo|metaharness|@metaharness|ruvector)/];
const errors = [];
async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {
      const text = await readFile(file, "utf8");
      const lines = text.split(/\r?\n/).length;
      if (lines > 500) errors.push(`${file}: ${lines} lines exceeds 500`);
      if (file.includes("/domain/") && forbidden.some((rule) => rule.test(text)))
        errors.push(`${file}: domain imports an upstream authority directly`);
    }
  }
}
for (const root of roots) await walk(root);
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
