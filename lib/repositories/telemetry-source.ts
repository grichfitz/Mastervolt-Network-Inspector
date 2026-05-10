import type { DeviceData, Yacht } from "@/lib/types";

/**
 * Abstraction for where normalized device + telemetry views come from.
 * Primary source: Supabase queries. Dev fallback: local fixture loader.
 *
 * Onboard agents → Cloud API → DB writes; the dashboard reads through implementations
 * of this shape without importing ingestion parsers in UI code.
 */
export type TelemetrySnapshotPort = {
  /** Snapshot-derived devices + last-known variable values (explorer / dashboard mode). */
  loadDevicesForYacht(yacht: Yacht): Promise<DeviceData[]>;
};
