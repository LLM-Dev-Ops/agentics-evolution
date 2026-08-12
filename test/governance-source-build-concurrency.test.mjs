import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec=promisify(execFile);
test("governance source cache serializes parallel clean installers",{timeout:180_000},async()=>{
  const cache=await mkdtemp(join(tmpdir(),"agentics-governance-cache-"));
  try {
    const env={...process.env,AGENTICS_UPSTREAM_CACHE:cache};
    const runs=await Promise.all([exec("node",["scripts/build-governance-authorities.mjs"],{env,maxBuffer:16_000_000}),exec("node",["scripts/build-governance-authorities.mjs"],{env,maxBuffer:16_000_000})]);
    for(const run of runs){const evidence=JSON.parse(run.stdout);assert.equal(evidence.length,4);assert.ok(evidence.every(item=>item.status==="BUILT"));}
    const report=JSON.parse(await readFile("reports/governance-authority-builds.json","utf8"));assert.equal(report.authorities.length,4);
  } finally { await rm(cache,{recursive:true,force:true}); }
});
