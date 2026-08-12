import assert from "node:assert/strict";import test from "node:test";import{parseTapEvidence,validateTapEvidence}from"../scripts/lib/tap-evidence.mjs";
const tap=(outcome="ok",summary={tests:1,pass:1,fail:0,cancelled:0,skipped:0,todo:0},name="required assertion")=>`TAP version 13\n# Subtest: ${name}\n${outcome} 1 - ${name}\n1..1\n${Object.entries(summary).map(([key,value])=>`# ${key} ${value}`).join("\n")}\n`;
test("evidence semantics reject failed, skipped, and missing required assertions",()=>{
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap("not ok",{tests:1,pass:0,fail:1,cancelled:0,skipped:0,todo:0}))),/NON_PASS/);
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap("ok",{tests:1,pass:0,fail:0,cancelled:0,skipped:1,todo:0}))),/NON_PASS/);
 assert.throws(()=>validateTapEvidence(parseTapEvidence(tap()),["absent control"]),/REQUIRED_SUBTEST_MISSING/);
 assert.doesNotThrow(()=>validateTapEvidence(parseTapEvidence(tap()),["required assertion"]));
});
test("evidence semantics count nested and top-level points exactly and reject nested non-pass directives",()=>{const nested=`TAP version 13\n# Subtest: parent\n    ok 1 - child assertion\n    1..1\nok 1 - parent\n1..1\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;assert.doesNotThrow(()=>validateTapEvidence(parseTapEvidence(nested),["child assertion","parent"]));for(const point of ["    not ok 1 - child assertion","    ok 1 - child assertion # SKIP unavailable","    ok 1 - child assertion # TODO later"])assert.throws(()=>validateTapEvidence(parseTapEvidence(nested.replace("    ok 1 - child assertion",point))),/NON_PASS/);});
