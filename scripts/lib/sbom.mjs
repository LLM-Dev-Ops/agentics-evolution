export function mergeSboms(base, platform) {
  const components = new Map();
  for (const component of [...(base.components ?? []), ...(platform.components ?? [])])
    components.set(component["bom-ref"], component);
  components.set(platform.metadata.component["bom-ref"], platform.metadata.component);
  const dependencies = new Map();
  for (const dependency of [...(base.dependencies ?? []), ...(platform.dependencies ?? [])]) {
    const current = dependencies.get(dependency.ref) ?? new Set();
    for (const ref of dependency.dependsOn ?? []) current.add(ref);
    dependencies.set(dependency.ref, current);
  }
  return {
    ...base,
    components: [...components.values()].sort((left, right) => left["bom-ref"].localeCompare(right["bom-ref"])),
    dependencies: [...dependencies.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
    compositions: [...(base.compositions ?? []), { aggregate: "complete", assemblies: [platform.metadata.component["bom-ref"]] }],
    metadata: {
      ...base.metadata,
      properties: [...(base.metadata.properties ?? []),
        { name: "agentics:platform-root", value: platform.metadata.component["bom-ref"] },
        { name: "agentics:platform-sbom-serial", value: platform.serialNumber },
        { name: "agentics:platform-component-count", value: String(platform.components?.length ?? 0) }]
    }
  };
}

export function platformGraphFailures(sbom) {
  const failures = [];
  const root = sbom.metadata?.properties?.find(({ name }) => name === "agentics:platform-root")?.value;
  const expected = Number(sbom.metadata?.properties?.find(({ name }) => name === "agentics:platform-component-count")?.value);
  const dependencies = new Map((sbom.dependencies ?? []).map((entry) => [entry.ref, entry]));
  const entities = new Set([
    sbom.metadata?.component?.["bom-ref"],
    ...(sbom.components ?? []).map((component) => component["bom-ref"]),
    ...(sbom.services ?? []).map((service) => service["bom-ref"])
  ].filter(Boolean));
  if (!root || !entities.has(root)) failures.push("platform root entity is missing");
  if (!root || !dependencies.has(root)) failures.push("platform root dependency node is missing");
  const reachable = new Set();
  const visit = (ref) => { if (reachable.has(ref)) return; reachable.add(ref); for (const child of dependencies.get(ref)?.dependsOn ?? []) visit(child); };
  if (root) visit(root);
  const platformComponents = (sbom.components ?? []).filter((component) => component["bom-ref"]?.startsWith(`${root}|`));
  if (!Number.isInteger(expected) || platformComponents.length !== expected) failures.push("platform component count does not match merged SBOM");
  for (const component of platformComponents)
    if (!dependencies.has(component["bom-ref"]) || !reachable.has(component["bom-ref"])) failures.push(`${component.name}: platform dependency edge is missing`);
  return failures;
}
