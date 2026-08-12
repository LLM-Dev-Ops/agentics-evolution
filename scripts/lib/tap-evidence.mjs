const summaryKeys=["tests","pass","fail","cancelled","skipped","todo"];
export function parseTapEvidence(tap){
 const summary=Object.fromEntries(summaryKeys.map(key=>{const matches=[...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`,"gm"))];const match=matches.at(-1);if(!match)throw new Error(`TAP_SUMMARY_MISSING:${key}`);return[key,Number(match[1])];}));
 const passedSubtests=[];for(const match of tap.matchAll(/^ok \d+ - (.+)$/gm)){const name=match[1].replace(/ # SKIP.*$/,"").replace(/ # TODO.*$/,"/").trim();if(!/# (?:SKIP|TODO)/.test(match[0]))passedSubtests.push(name);}
 const nestedNonPass=/^\s+(?:not ok \d+|ok \d+.*# (?:SKIP|TODO))/m.test(tap);return Object.freeze({summary:Object.freeze(summary),passedSubtests:Object.freeze(passedSubtests),nestedNonPass});
}
export function validateTapEvidence(evidence,requiredSubtests=[]){
 const {summary,passedSubtests,nestedNonPass}=evidence;if(summary.fail||summary.cancelled||summary.skipped||summary.todo||nestedNonPass)throw new Error("TAP_NON_PASS_OUTCOME");
 if(summary.tests<1||summary.pass!==summary.tests||passedSubtests.length!==summary.tests)throw new Error("TAP_PASS_COUNT_MISMATCH");
 if(new Set(passedSubtests).size!==passedSubtests.length)throw new Error("TAP_DUPLICATE_SUBTEST_NAME");
 for(const name of requiredSubtests)if(!passedSubtests.includes(name))throw new Error(`TAP_REQUIRED_SUBTEST_MISSING:${name}`);return evidence;
}
