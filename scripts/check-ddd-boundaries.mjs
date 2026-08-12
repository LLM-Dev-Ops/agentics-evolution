import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import ts from "typescript";
import { parse } from "yaml";

const repository = resolve(process.argv[2] ?? ".");
const config = parse(await readFile(resolve(repository, process.argv[3] ?? "config/context-boundaries.yaml"), "utf8"));
const contextsRoot = resolve(repository, config.root);
const normalized = (value) => value.split(sep).join("/");
const errors = [];
const expected = new Set(config.contexts);
const exists = async (path) => stat(path).then(() => true, () => false);
const packageName = (specifier) => specifier.startsWith("@")
  ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0];

async function sourceFiles(path) {
  if (!await exists(path)) return [];
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const candidate = join(path, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(candidate));
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(candidate);
  }
  return files;
}

const actual = new Set((await readdir(contextsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory()).map((entry) => entry.name));
for (const name of expected) {
  if (!actual.has(name)) errors.push(`context '${name}' is missing`);
  for (const layer of config.requiredLayers) {
    if (!await exists(join(contextsRoot, name, layer, "index.ts"))) errors.push(`${name}: required ${layer}/index.ts is missing`);
  }
  if (!await exists(join(contextsRoot, name, config.publicEntrypoint))) errors.push(`${name}: public ${config.publicEntrypoint} is missing`);
  if (!await exists(join(contextsRoot, name, "published-language.ts"))) errors.push(`${name}: published-language.ts is missing`);
}
for (const name of actual) if (!expected.has(name)) errors.push(`unrecorded context directory '${name}'`);

function contextParts(file) {
  const parts = normalized(relative(contextsRoot, file)).split("/");
  return { context: parts[0], layer: parts[1], location: `${config.root}/${parts.join("/")}` };
}
function targetParts(file, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const target = normalized(relative(contextsRoot, resolve(dirname(file), specifier))).replace(/\.[cm]?[jt]sx?$/, "");
  const parts = target.split("/");
  return { context: parts[0], segment: parts[1], target };
}
function checkReference(file, specifier, isExport) {
  const from = contextParts(file);
  if (config.upstreamPackages.includes(packageName(specifier)))
    errors.push(`${from.location}: raw upstream type/import '${specifier}' leaks into a bounded context`);
  if (!expected.has(from.context)) return;
  const target = targetParts(file, specifier);
  if (!target || !expected.has(target.context)) return;
  if (from.location === `${config.root}/${from.context}/${config.publicEntrypoint}` &&
      config.forbiddenPublicSegments.includes(target.segment))
    errors.push(`${from.location}: public context entrypoint exposes ${target.segment}`);
  if (target.context === from.context) {
    if (from.layer === "domain" && ["application", "infrastructure"].includes(target.segment))
      errors.push(`${from.location}: domain cannot depend on ${target.segment}`);
    if (from.layer === "application" && target.segment === "infrastructure")
      errors.push(`${from.location}: application cannot depend on infrastructure`);
    return;
  }
  if (from.layer === "domain") errors.push(`${from.location}: domain cannot import another context '${target.context}'`);
  else if (!config.allowedCrossContextTargets.includes(target.segment))
    errors.push(`${from.location}: cross-context dependency may target only ${config.allowedCrossContextTargets.join(" or ")}, not '${target.segment}'`);
  if (isExport) errors.push(`${from.location}: context public surface cannot re-export another context`);
}
function checkEvents(ast, location) {
  const inspect = (node) => {
    const heritage = node.heritageClauses?.flatMap((clause) => clause.types) ?? [];
    const isEvent = (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) &&
      heritage.some((type) => type.expression.getText(ast).endsWith("DomainEvent"));
    if (isEvent) {
      const name = node.name?.text ?? "anonymous";
      if (!/(?:ed|en|wn|ught)$/.test(name)) errors.push(`${location}: domain event '${name}' must use a past-tense name`);
      const aggregateId = node.members.some((member) => member.name?.getText(ast).replace(/["']/g, "") === "aggregateId");
      if (!aggregateId) errors.push(`${location}: domain event '${name}' must carry aggregateId`);
      const readonlyAggregate = node.members.some((member) => member.name?.getText(ast).replace(/["']/g, "") === "aggregateId" &&
        member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ReadonlyKeyword));
      if (!readonlyAggregate) errors.push(`${location}: domain event '${name}' aggregateId must be readonly`);
    }
    ts.forEachChild(node, inspect);
  };
  inspect(ast);
}

for (const file of await sourceFiles(contextsRoot)) {
  const { location } = contextParts(file);
  const text = await readFile(file, "utf8");
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      checkReference(file, node.moduleSpecifier.text, ts.isExportDeclaration(node));
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      checkReference(file, node.argument.literal.text, false);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0]))
      checkReference(file, node.arguments[0].text, false);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  checkEvents(ast, location);
}

if (errors.length) { console.error([...new Set(errors)].sort().join("\n")); process.exit(1); }
