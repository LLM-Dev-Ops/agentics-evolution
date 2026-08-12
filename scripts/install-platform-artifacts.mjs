import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

const catalog = parse(await readFile("config/upstream-authorities.yaml", "utf8"));
const architecture = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
if (process.platform !== "linux" || !architecture) throw new Error(`unsupported capability platform ${process.platform}-${process.arch}`);
const selected = catalog.platformArtifacts.filter(({ platform }) => platform === "any" || platform === `linux-${architecture}-gnu`);
if (!selected.length) throw new Error(`no platform artifacts selected for linux-${architecture}-gnu`);
const args = ["install", "--no-save", "--ignore-scripts", "--omit=optional", ...selected.map(({ package: name, version }) => `${name}@${version}`)];
execFileSync("npm", args, { stdio: "inherit" });
console.log(JSON.stringify({ platform: `linux-${architecture}-gnu`, packages: selected.map(({ package: name, version }) => `${name}@${version}`) }));
