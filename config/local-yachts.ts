import type { Yacht } from "@/lib/types";

/**
 * Platform-level yacht registry for local / offline testing.
 * Ownership comes from here — never from XML or telemetry payloads.
 *
 * JSONL snapshots remain yacht-agnostic; we attach them to a chosen yacht in code.
 */
export const TEST_YACHT: Yacht = {
  id: "test-yacht",
  slug: "serenity",
  name: "Serenity"
};

/** All yachts visible in local explorer mode (expand as needed). */
export const LOCAL_YACHT_REGISTRY: Yacht[] = [TEST_YACHT];

/** Yacht IDs that use `data/snapshot_parsed.jsonl` as the telemetry source in dev. */
export const LOCAL_JSONL_YACHT_IDS = new Set<string>([TEST_YACHT.id]);

export function getLocalYachtBySlug(slug: string): Yacht | undefined {
  return LOCAL_YACHT_REGISTRY.find((y) => y.slug === slug);
}

export function getLocalYachtById(id: string): Yacht | undefined {
  return LOCAL_YACHT_REGISTRY.find((y) => y.id === id);
}

export function listLocalYachts(): Yacht[] {
  return [...LOCAL_YACHT_REGISTRY];
}

export function usesLocalJsonlDataset(yachtId: string): boolean {
  return LOCAL_JSONL_YACHT_IDS.has(yachtId);
}
