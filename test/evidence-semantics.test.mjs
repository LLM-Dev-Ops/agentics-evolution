import assert from "node:assert/strict";import test from "node:test";import{parseTapEvidence,validateTapEvidence}from"../scripts/lib/tap-evidence.mjs";
const tap=(outcome="ok",summary={tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0},name="required assertion")=>`TAP version 13\n# Subtest: ${name}\n${outcome} 1 - ${name}\n1..1\n${Object.entries(summary).map(([key,value])=>`# ${key} ${value}`).join("\n")}\n`;
test("evidence semantics reject failed, skipped, and missing required assertions",()=>{
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap("not ok",{tests:1,pass:0,fail:1,cancelled:0,skipped:0,todo:0}))),/NON_PASS/);
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap("ok",{tests:1,pass:0,fail:0,cancelled:0,skipped:1,todo:0}))),/NON_PASS/);
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap()),["absent control"]),/REQUIRED_SUBTEST_MISSING/);
 assert.doesNotThrow(()=>validateTapEvidence(parseTapEvidence(tap()),["required assertion"]));
});
