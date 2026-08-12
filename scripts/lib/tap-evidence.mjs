const summaryKeys=["tests","pass","fail","cancelled","skipped","todo"];
export function parseTapEvidence(tap){
 const summary=Object.fromEntries(summaryKeys.map(key=>{const match=tap.match(new RegExp(`^# ${key} (\\d+)$`,"m"));if(!match)throw new Error(`TAP_SUMMARY_MISSING:${key}`);return[key,Number(match[1])];}));
 const passedSubtests=[];for(const match of tap.matchAll(/^ok \d+ - (.+)$/gm)){const name=match[1].replace(/ # SKIP.*$/,"").replace(/ # TODO.*$/,"/").trim();if(!/# (?:SKIP|TODO)/.test(match[0]))passedSubtests.push(name);}
 return Object.freeze({summary:Object.freeze(summary),passedSubtests:Object.freeze(passedSubtests)});
}
export function validateTapEvidence(evidence,requiredSubtests=[]){
 const {summary,passedSubtests}=evidence;if(summary.fail||summary.cancelled||summary.skipped||summary.todo)throw new Error("TAP_NON_PASS_OUTCOME");
 if(summary.tests<1||summary.pass!==summary.tests||passedSubtests.length!==summary.tests)throw new Error("TAP_PASS_COUNT_MISMATCH");
 if(new Set(passedSubtests).size!==passedSubtests.length)throw new Error("TAP_DUPLICATE_SUBTEST_NAME");
 for(const name of requiredSubtests)if(!passedSubtests.includes(name))throw new Error(`TAP_REQUIRED_SUBTEST_MISSING:${name}`);return evidence;
}
