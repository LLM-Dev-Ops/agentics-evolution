import { EvolutionEnvelope } from "./evolution-envelope.js";
export type PayloadValidator = (payload: Readonly<Record<string, unknown>>) => void;
export class EnvelopeSchemaRegistry {
  readonly #schemas = new Map<string, PayloadValidator>();
  register(eventType: string, schemaVersion: number, validator: PayloadValidator): void {
    const key = `${eventType}@${schemaVersion}`;
    if (this.#schemas.has(key)) throw new TypeError(`schema already registered: ${key}`);
    this.#schemas.set(key, validator);
  }
  validate(envelope: EvolutionEnvelope): void {
    const key = `${envelope.type}@${envelope.schemaVersion}`;
    const validator = this.#schemas.get(key);
    if (!validator) throw new TypeError(`UNKNOWN_SCHEMA_VERSION: ${key}`);
    validator(envelope.payload);
  }
}
