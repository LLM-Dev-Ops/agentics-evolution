import { link, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
const path = process.argv[2]; const mode = process.argv[3] ?? "canonical"; const stat = await readFile(`/proc/${process.pid}/stat`, "utf8"); const start = stat.split(" ")[21];
await mkdir(dirname(path), { recursive: true }); const lease = JSON.stringify({ ownerId: randomUUID(), pid: process.pid, start, expiresAt: Date.now() - 1 });
if (mode === "temp") { const temporary = `${path}.tmp-child`; const handle = await open(temporary, "wx", 0o600); await handle.writeFile(lease); await handle.sync(); await handle.close(); }
else { const temporary = `${path}.tmp-child`; await writeFile(temporary, lease, { flag: "wx", mode: 0o600 }); await link(temporary, path); await rm(temporary); }
process.stdout.write("ready\n"); setInterval(() => undefined, 1_000);
