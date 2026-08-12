import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
const path = process.argv[2]; const stat = await readFile(`/proc/${process.pid}/stat`, "utf8"); const start = stat.split(" ")[21];
await mkdir(dirname(path), { recursive: true }); await writeFile(path, JSON.stringify({ ownerId: randomUUID(), pid: process.pid, start, expiresAt: Date.now() - 1 }), { flag: "wx" });
process.stdout.write("ready\n"); setInterval(() => undefined, 1_000);
