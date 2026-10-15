import type { TaggerAdapter } from "./types.ts";

const OFF_MESSAGE =
  'Tagging is off. Run "pnpm refs setup" to choose a tagger.';

export function createNoneAdapter(): TaggerAdapter {
  return {
    id: "none",
    async check() {
      return { ok: true, detail: "Tagging is off" };
    },
    async describe() {
      throw new Error(OFF_MESSAGE);
    },
  };
}

export { OFF_MESSAGE as noneAdapterOffMessage };
