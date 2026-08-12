import { NativeRvfWitnessAdapter } from "../../dist/infrastructure/upstream-ruvector/rvf-witness-adapter.js";

export async function verifyNativeRvf({ rvfBytes, identityMapBytes, expectedVectorCount }) {
  await new NativeRvfWitnessAdapter().verifyContainer(rvfBytes, identityMapBytes, expectedVectorCount);
}
