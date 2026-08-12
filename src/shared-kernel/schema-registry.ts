import { EvolutionEnvelope } from "./evolution-envelope.js";
import { ENVELOPE_SCHEMA } from "./evolution-envelope.js";
import { canonicalJson } from "./immutable.js";
import { digestBytes } from "./digest.js";
export interface PayloadSchema {
  readonly schemaId: string;
  readonly allowedFields: readonly string[];
  readonly requiredFields?: readonly string[];
  readonly validate?: (payload: Readonly<Record<string, unknown>>) => void;
}
export class EnvelopeSchemaRegistry {
  readonly #schemas = new Map<string, PayloadSchema>();
  register(eventType: string, schemaVersion: number, schema: PayloadSchema): void {
    if (!/^agentics\.[a-z0-9.-]+\/v\d+$/.test(schema.schemaId)) throw new TypeError("payload schema requires versioned schemaId");
    const key = `${ENVELOPE_SCHEMA}:${eventType}@${schemaVersion}`;
    if (this.#schemas.has(key)) throw new TypeError(`schema already registered: ${key}`);
    this.#schemas.set(key, Object.freeze({ ...schema, allowedFields: Object.freeze([...schema.allowedFields]), requiredFields: Object.freeze([...(schema.requiredFields ?? [])]) }));
  }
  validate(envelope: EvolutionEnvelope): void {
    const key = `${envelope.envelopeSchema}:${envelope.type}@${envelope.schemaVersion}`;
    const schema = this.#schemas.get(key);
    if (!schema) throw new TypeError(`UNKNOWN_SCHEMA_VERSION: ${key}`);
    if (!envelope.payload || typeof envelope.payload !== "object" || Array.isArray(envelope.payload)) throw new TypeError("payload must be a plain object");
    for (const field of Object.keys(envelope.payload)) if (!schema.allowedFields.includes(field)) throw new TypeError(`unknown critical payload field: ${field}`);
    for (const field of schema.requiredFields ?? []) if (!Object.hasOwn(envelope.payload, field)) throw new TypeError(`missing required payload field: ${field}`);
    schema.validate?.(envelope.payload);
  }
  digest(): string { return digestBytes(new TextEncoder().encode(canonicalJson([...this.#schemas].map(([key, schema]) => ({ key, schemaId: schema.schemaId, allowedFields: schema.allowedFields, requiredFields: schema.requiredFields ?? [] })).sort((a, b) => a.key.localeCompare(b.key))))); }
}
