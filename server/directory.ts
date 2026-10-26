import { starterEntries } from "@/lib/crm/directory";
import type { ResearchStore } from "@/lib/research/store";

/** Load the starter directory. Idempotent: entries already present (same name + city) are left alone. */
export async function seedDirectory(store: ResearchStore, actor: string) {
  const { created, existing } = await store.upsertEntries(starterEntries(), actor, { fillBlanks: true });
  return { created: created.length, existing: existing.length };
}

/** First run convenience: an empty database gets the starter directory so the Discovery tab is never blank. */
export async function ensureDirectory(store: ResearchStore) {
  const any = await store.listRecords({});
  if (any.length === 0) await seedDirectory(store, "system");
}
