import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, join, dirname, sep } from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import ts from "typescript";
import { parse } from "yaml";

const root = resolve(process.argv[2] ?? ".");
const policy = parse(await readFile(resolve(root, process.argv[3] ?? "config/source-policy.yaml"), "utf8"));
const catalog = parse(await readFile(resolve(root, "config/upstream-authorities.yaml"), "utf8"));
const errors = [];
const normalized = (path) => path.split(sep).join("/");
const rel = (path) => normalized(relative(root, path));
const exemptions = new Map(policy.generatedExemptions.map((item) => [item.path, item.reason]));
const sourceExtensions = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const ignoredDirectories = new Set([".git", "node_modules", "dist", "coverage", ".ruflo", ".claude-flow", "reports"]);

function extension(path) { return path.match(/\.[^.\/]+$/)?.[0] ?? ""; }
async function filesUnder(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (ignoredDirectories.has(entry.name)) continue;
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(candidate));
    else result.push(candidate);
  }
  return result;
}
function packageName(specifier) {
  return specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];
}
function inspectModuleReference(file, specifier) {
  const dependency = packageName(specifier);
  const adapter = policy.allowedUpstreamAdapters[dependency];
  if (!adapter) return;
  const location = rel(file);
  if (location.startsWith("test/") && policy.upstreamContractTests.includes(location)) return;
  if (location !== adapter && !location.startsWith(`${adapter}/`))
    errors.push(`${location}: upstream import/export '${specifier}' must be owned by ${adapter}`);

}
function inspectLayerReference(file, specifier) {
  if (!specifier.startsWith(".")) return;
  const location = rel(file);
  const target = normalized(relative(root, resolve(dirname(file), specifier)));
  const { domain, application, infrastructure } = policy.layers;
  if ((location === domain || location.startsWith(`${domain}/`)) &&
      (target === application || target.startsWith(`${application}/`) || target === infrastructure || target.startsWith(`${infrastructure}/`)))
    errors.push(`${location}: domain cannot import application or infrastructure module '${specifier}'`);
  if ((location === application || location.startsWith(`${application}/`)) &&
      (target === infrastructure || target.startsWith(`${infrastructure}/`)))
    errors.push(`${location}: application cannot import infrastructure module '${specifier}'`);
  if (policy.publicEntrypoints.includes(location) && (target === infrastructure || target.startsWith(`${infrastructure}/`)))
    errors.push(`${location}: public entrypoint cannot export infrastructure module '${specifier}'`);
}
function inspectSource(file, text) {
  const location = rel(file);
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const fingerprinted = new Set();
  const normalizeNode = (node) => {
    if (ts.isIdentifier(node)) return "Identifier";
    if (ts.isStringLiteral(node) || ts.isNumericLiteral(node) ||
        node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword)
      return ts.SyntaxKind[node.kind];
    return `${ts.SyntaxKind[node.kind]}(${node.getChildren(ast).map(normalizeNode).join(",")})`;
  };
  const inspectFingerprint = (node) => {
    if (!node.body || fingerprinted.has(node)) return;
    fingerprinted.add(node);
    const parameters = node.parameters?.map((parameter) => normalizeNode(parameter)).join(",") ?? "";
    const shape = `params(${parameters})body(${normalizeNode(node.body)})`;
    const digest = createHash("sha256").update(shape).digest("hex");
    for (const [family, fingerprints] of Object.entries(policy.algorithmFingerprints ?? {})) {
      if (fingerprints.includes(digest)) errors.push(`${location}: structurally duplicates upstream-owned ${family} algorithm (${digest})`);
    }
  };
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      { inspectModuleReference(file, node.moduleSpecifier.text); inspectLayerReference(file, node.moduleSpecifier.text); }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      { inspectModuleReference(file, node.arguments[0].text); inspectLayerReference(file, node.arguments[0].text); }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "require" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      { inspectModuleReference(file, node.arguments[0].text); inspectLayerReference(file, node.arguments[0].text); }
    if (ts.isFunctionDeclaration(node) && node.name && policy.forbiddenAlgorithmSymbols.includes(node.name.text))
      errors.push(`${location}: duplicates upstream-owned algorithm symbol '${node.name.text}'`);
    if (ts.isClassDeclaration(node) && node.name && policy.forbiddenAlgorithmSymbols.includes(node.name.text))
      errors.push(`${location}: duplicates upstream-owned algorithm symbol '${node.name.text}'`);
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node))
      inspectFingerprint(node);
    ts.forEachChild(node, visit);
  };
  visit(ast);
}

const allFiles = await filesUnder(root);
for (const file of allFiles) {
  const location = rel(file);
  if (exemptions.has(location)) continue;
  const text = await readFile(file, "utf8");
  const lines = text === "" ? 0 : text.split(/\r?\n/).length;
  if (lines > policy.maxLines) errors.push(`${location}: ${lines} lines exceeds ${policy.maxLines}`);
  if (sourceExtensions.has(extension(file))) inspectSource(file, text);
  if (location.startsWith(".github/workflows/") && /uses:\s*[^\s@]+@(?!(?:[a-f0-9]{40})(?:\s|$))[^\s]+/i.test(text))
    errors.push(`${location}: GitHub Actions must use immutable 40-character commit SHAs`);
}
const catalogPackages = new Set(catalog.authorities.map((entry) => entry.package));
for (const item of catalog.hosts ?? []) catalogPackages.add(item.package);
const implicitPackages = new Set(["claude-flow", "@claude-flow/cli", "@metaharness/kernel"]);
for (const dependency of Object.keys(policy.allowedUpstreamAdapters)) {
  if (!catalogPackages.has(dependency) && !implicitPackages.has(dependency))
    errors.push(`source-policy: '${dependency}' has no upstream authority record`);
}
for (const authority of catalog.authorities) {
  const expected = policy.allowedUpstreamAdapters[authority.package];
  if (expected !== `src/${authority.adapter}`)
    errors.push(`${authority.package}: catalog adapter '${authority.adapter}' disagrees with source policy '${expected ?? "missing"}'`);
}
for (const family of policy.requiredAlgorithmFamilies ?? []) {
  const fingerprints = policy.algorithmFingerprints?.[family];
  if (!Array.isArray(fingerprints) || fingerprints.length === 0)
    errors.push(`source-policy: required algorithm family '${family}' has no structural fingerprints`);
  for (const fingerprint of fingerprints ?? []) {
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) errors.push(`source-policy: ${family} has invalid SHA-256 fingerprint '${fingerprint}'`);
  }
}
const manifestFile = allFiles.find((file) => rel(file) === "package.json");
if (manifestFile) {
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  const inspectExportTarget = (value, key = ".") => {
    if (typeof value === "string" && /(?:^|\/)infrastructure(?:\/|$)/.test(value))
      errors.push(`package.json: export '${key}' exposes infrastructure target '${value}'`);
    else if (value && typeof value === "object")
      for (const [childKey, childValue] of Object.entries(value)) inspectExportTarget(childValue, key === "." ? childKey : `${key}.${childKey}`);
  };
  inspectExportTarget(manifest.exports);
}
for (const exemption of policy.generatedExemptions) {
  if (!exemption.reason?.trim()) errors.push(`${exemption.path}: generated exemption requires a reason`);
  if (!exemption.optional && !allFiles.some((file) => rel(file) === exemption.path)) errors.push(`${exemption.path}: generated exemption does not match a file`);
}
if (errors.length) { console.error(errors.sort().join("\n")); process.exit(1); }
