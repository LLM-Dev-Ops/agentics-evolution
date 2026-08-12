#!/usr/bin/env node
import { verifyBundle } from "./index.mjs";
const [root, checkpoint] = process.argv.slice(2);
try { console.log(JSON.stringify(await verifyBundle(root, checkpoint))); }
catch (error) { console.error(JSON.stringify({ valid: false, reason: error instanceof Error ? error.message : "VERIFICATION_FAILED" })); process.exitCode = 1; }
