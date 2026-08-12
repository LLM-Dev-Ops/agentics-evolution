import { isNativeAvailable, isRvfAvailable, openRvfStore, rvfClose, rvfStatus } from "ruvector";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function verifyNativeRvf({ rvfBytes, identityMapBytes, expectedVectorCount }) {
  if (!isNativeAvailable() || !isRvfAvailable()) throw new Error("NATIVE_RVF_VERIFIER_UNAVAILABLE");
  const directory = await mkdtemp(join(tmpdir(), "agentics-offline-rvf-")); const path = join(directory, "witness.rvf"); let store;
  try {
    await writeFile(path, rvfBytes, { flag: "wx", mode: 0o600 }); await writeFile(`${path}.idmap.json`, identityMapBytes, { flag: "wx", mode: 0o600 });
    store = await openRvfStore(path); const status = await rvfStatus(store);
    if (!Number.isSafeInteger(expectedVectorCount) || expectedVectorCount < 1 || status.totalVectors !== expectedVectorCount) throw new Error("RVF_NATIVE_VECTOR_COUNT_MISMATCH");
  } catch (error) { if (error instanceof Error && error.message.startsWith("RVF_NATIVE_")) throw error; throw new Error("RVF_NATIVE_CONTAINER_INVALID", { cause: error }); }
  finally { if (store) await rvfClose(store).catch(() => undefined); await rm(directory, { recursive: true, force: true }); }
}
