import { createHash } from "node:crypto";
import type { DataClassification } from "../domain/capability.js";
export interface PrivacyFinding { readonly category: "PRIVATE_KEY" | "CREDENTIAL" | "TOKEN" | "EMAIL"; readonly count: number; }
export interface ScannedContent { readonly classification: DataClassification | "SECRET_PROHIBITED"; readonly redacted: string | null; readonly findings: readonly PrivacyFinding[]; readonly sourceDigest: string; }
export interface PrivacyScannerPort { scan(content: string, declared: DataClassification): Promise<ScannedContent>; }
const detectors = [
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["CREDENTIAL", /\b(?:password|passwd|api[_-]?key|client[_-]?secret)\s*[:=]\s*[^\s,;]+/gi],
  ["TOKEN", /\b(?:ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g],
  ["EMAIL", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi]
] as const;
export class DefaultPrivacyScanner implements PrivacyScannerPort {
  async scan(content: string, declared: DataClassification): Promise<ScannedContent> {
    if (Buffer.byteLength(content, "utf8") > 4 * 1024 * 1024) throw new TypeError("PRIVACY_SCAN_SIZE_LIMIT");
    const findings: PrivacyFinding[] = []; let redacted = content; let prohibited = false;
    for (const [category, expression] of detectors) { const matches = [...content.matchAll(expression)]; if (!matches.length) continue;
      findings.push(Object.freeze({ category, count: matches.length })); prohibited ||= category !== "EMAIL"; redacted = redacted.replace(expression, `[REDACTED:${category}]`); }
    return Object.freeze({ classification: prohibited ? "SECRET_PROHIBITED" : declared, redacted: prohibited ? null : redacted, findings: Object.freeze(findings), sourceDigest: createHash("sha256").update(content).digest("hex") });
  }
}
