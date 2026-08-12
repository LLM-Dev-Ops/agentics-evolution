export function dependencyPolicyFailures(name, entry, policy) {
  const failures = [];
  if (!entry?.integrity?.startsWith("sha512-")) failures.push(`${name}: missing trusted sha512 integrity`);
  let origin;
  try { origin = new URL(entry?.resolved).origin; } catch { failures.push(`${name}: invalid package provenance URL`); }
  if (origin && origin !== policy.registryOrigin) failures.push(`${name}: package provenance drifted to ${origin}`);
  return failures;
}

export function maintainerPolicyFailures(name, maintainers, policy) {
  const actual = [...maintainers].sort();
  const expected = [...policy.approvedMaintainers].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    return [`${name}: maintainer set drifted from approved identities`];
  return [];
}
