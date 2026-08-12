export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (![Object.prototype, null].includes(Object.getPrototypeOf(object))) throw new TypeError("only plain JSON objects are canonicalizable");
    return `{${Object.keys(object).sort().map((key) => {
      if (object[key] === undefined) throw new TypeError("undefined is not canonical JSON");
      return `${JSON.stringify(key)}:${canonicalJson(object[key])}`;
    }).join(",")}}`;
  }
  throw new TypeError("unsupported canonical JSON value");
}
