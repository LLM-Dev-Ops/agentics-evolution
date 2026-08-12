#!/usr/bin/env node
import { verifyBundle } from "./index.mjs";
const [root, checkpoint, expectedGateFingerprint, trustedKeyManifestSignerBase64] = process.argv.slice(2);
const trustedKeyManifestSignerPem = trustedKeyManifestSignerBase64 ? Buffer.from(trustedKeyManifestSignerBase64, "base64").toString("utf8") : undefined;
try { console.log(JSON.stringify(await verifyBundle(root, checkpoint, { expectedGateFingerprint, trustedKeyManifestSignerPem }))); }
catch (error) { console.error(JSON.stringify({ valid: false, reason: error instanceof Error ? error.message : "VERIFICATION_FAILED" })); process.exitCode = 1; }
