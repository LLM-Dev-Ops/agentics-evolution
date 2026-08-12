import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createSigner(privateKeyPem) {
  if (privateKeyPem) {
    const privateKey = createPrivateKey(privateKeyPem);
    return { privateKey, publicKey: createPublicKey(privateKey), identity: "configured-release-key" };
  }
  const keys = generateKeyPairSync("ed25519");
  return { ...keys, identity: "ephemeral-ci-key" };
}

export function signEnvelope(statement, signer) {
  const payload = Buffer.from(canonicalJson(statement));
  return {
    schemaVersion: "agentics.signed-evidence/v1",
    algorithm: "Ed25519",
    keyIdentity: signer.identity,
    publicKey: signer.publicKey.export({ type: "spki", format: "pem" }),
    payload: payload.toString("base64"),
    signature: sign(null, payload, signer.privateKey).toString("base64")
  };
}

export function verifyEnvelope(envelope, trustedPublicKeyPem) {
  if (envelope?.schemaVersion !== "agentics.signed-evidence/v1") throw new Error("unsupported evidence envelope");
  if (envelope.algorithm !== "Ed25519" || !envelope.payload || !envelope.signature || !envelope.publicKey)
    throw new Error("unsigned or incomplete evidence envelope");
  if (trustedPublicKeyPem && envelope.publicKey.trim() !== trustedPublicKeyPem.trim())
    throw new Error("evidence signing key is not trusted");
  const payload = Buffer.from(envelope.payload, "base64");
  const valid = verify(null, payload, createPublicKey(envelope.publicKey), Buffer.from(envelope.signature, "base64"));
  if (!valid) throw new Error("evidence signature verification failed");
  return JSON.parse(payload.toString("utf8"));
}

export function requireTrustedPublicKey(configuredKey, mode, embeddedKey) {
  if (configuredKey) return configuredKey;
  if (["development", "test"].includes(mode)) return embeddedKey;
  throw new Error("production verification requires separately trusted public key");
}

export function validateSlsaV1(statement) {
  if (statement?._type !== "https://in-toto.io/Statement/v1") throw new Error("in-toto Statement v1 required");
  if (statement.predicateType !== "https://slsa.dev/provenance/v1") throw new Error("SLSA provenance v1 required");
  if (!Array.isArray(statement.subject) || statement.subject.length === 0) throw new Error("SLSA subjects required");
  if (!statement.predicate?.buildDefinition?.buildType || !statement.predicate?.runDetails?.builder?.id)
    throw new Error("SLSA buildDefinition and runDetails required");
  return statement;
}
