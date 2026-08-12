const TOKEN_NAME="AGENTICS_UPSTREAM_TOKEN";
export function githubGitEnvironment(environment=process.env){
  const token=environment[TOKEN_NAME]?.trim();if(!token)return environment;
  if(/[\r\n\0]/u.test(token))throw new TypeError(`${TOKEN_NAME}_INVALID`);
  const existing=Number.parseInt(environment.GIT_CONFIG_COUNT??"0",10);
  if(!Number.isSafeInteger(existing)||existing<0)throw new TypeError("GIT_CONFIG_COUNT_INVALID");
  return {...environment,GIT_CONFIG_COUNT:String(existing+1),[`GIT_CONFIG_KEY_${existing}`]:"http.https://github.com/.extraheader",[`GIT_CONFIG_VALUE_${existing}`]:`AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`};
}
export function sanitizedGitError(error,token=process.env[TOKEN_NAME]){const raw=error instanceof Error?error.message:String(error);const values=[token,token?Buffer.from(`x-access-token:${token}`).toString("base64"):undefined].filter(Boolean);return values.reduce((text,value)=>text.split(value).join("[REDACTED]"),raw).slice(0,500);}
