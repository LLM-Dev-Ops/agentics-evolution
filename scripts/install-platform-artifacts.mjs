import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "yaml";

const catalog = parse(await readFile("config/upstream-authorities.yaml", "utf8"));
const architecture = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (process.platform !== "linux" || !architecture) throw new Error(`unsupported capability platform ${process.platform}-${process.arch}`);
const selected = catalog.platformArtifacts.filter(({ platform }) => platform === "any" || platform === `linux-${architecture}-gnu`);
if (!selected.length) throw new Error(`no platform artifacts selected for linux-${architecture}-gnu`);
const root = resolve(".agentics-platform");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await writeFile(`${root}/package.json`, `${JSON.stringify({
  name: `agentics-platform-${architecture}`,
  version: "0.0.0",
  private: true,
  dependencies: Object.fromEntries(selected.map(({ package: name, version }) => [name, version]))
}, null, 2)}\n`);
execFileSync("npm", ["install", "--ignore-scripts", "--omit=optional"], { cwd: root, stdio: "inherit" });
execFileSync("npm", ["ls", "--all"], { cwd: root, stdio: "ignore" });
console.log(JSON.stringify({ platform: `linux-${architecture}-gnu`, modulePath: `${root}/node_modules`, packages: selected.map(({ package: name, version }) => `${name}@${version}`) }));
