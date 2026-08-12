import test from "node:test";
import assert from "node:assert/strict";
import { DefaultPrivacyScanner } from "../dist/contexts/governance/application/privacy-scanner.js";
test("secret-prohibited material never leaves the scanner as normal content", async () => {
  const scanner = new DefaultPrivacyScanner(); const result = await scanner.scan("api_key=sk-abcdefghijklmnopqrstuvwxyz123456", "CONFIDENTIAL");
  assert.equal(result.classification, "SECRET_PROHIBITED"); assert.equal(result.redacted, null); assert.equal(result.sourceDigest.length, 64); assert.equal(JSON.stringify(result).includes("abcdefghijklmnopqrstuvwxyz"), false);
});
test("PII is redacted before persistence while safe input is preserved", async () => {
  const scanner = new DefaultPrivacyScanner(); const pii = await scanner.scan("contact alice@example.com", "INTERNAL"); assert.equal(pii.redacted, "contact [REDACTED:EMAIL]"); assert.equal((await scanner.scan("safe", "PUBLIC")).redacted, "safe");
});
test("credential and PII corpus is prohibited or redacted without raw persistence material", async () => {
  const scanner = new DefaultPrivacyScanner(); const fixtures = [
    ["password=hunter-two", true], ["client_secret=abcdef", true], ["ghp_abcdefghijklmnopqrstuvwxyz012345", true],
    ["sk-abcdefghijklmnopqrstuvwxyz012345", true], ["alice@example.com", false]
  ];
  for (const [content, prohibited] of fixtures) { const result = await scanner.scan(content, "CONFIDENTIAL");
    assert.equal(result.classification === "SECRET_PROHIBITED", prohibited); assert.equal(JSON.stringify(result).includes(content), false); }
});
