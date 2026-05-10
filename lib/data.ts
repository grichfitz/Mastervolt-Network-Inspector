import fs from "node:fs/promises";
import path from "node:path";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";

import { listLocalYachts, getLocalYachtBySlug, usesLocalJsonlDataset } from "@/config/local-yachts";
import { buildDevices, countTelemetryVariables } from "@/lib/groupData";
import type { Yacht } from "@/lib/types";
import { DeviceData, DeviceSummary, Variable } from "@/lib/types";

function normalizeValue(value: unknown): Variable["value"] {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (value === undefined) {
    return null;
  }

  return String(value);
}

function toBusId(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseDeviceSummary(candidate: Record<string, unknown>): DeviceSummary | null {
  const kind = candidate.kind;
  if (kind !== "device_summary") {
    return null;
  }

  const busId = toBusId(candidate.bus_id);
  const deviceName = typeof candidate.device_name === "string" ? candidate.device_name.trim() : "";

  if (busId === null || !deviceName) {
    return null;
  }

  const str = (key: string) => {
    const v = candidate[key];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };

  return {
    deviceName,
    productId: str("product_id"),
    serialNumber: str("serial_number"),
    firmwareVersion: str("firmware_version"),
    softwareVersion: str("software_version"),
    productName: str("product_name")
  };
}

function toTelemetryVariable(candidate: Record<string, unknown>): Variable | null {
  const kind = candidate.kind;
  if (kind === "device_summary") {
    return null;
  }

  const busId = toBusId(candidate.bus_id);
  if (busId === null) {
    return null;
  }

  if (typeof candidate.index !== "number" || typeof candidate.label !== "string" || typeof candidate.writeable !== "boolean") {
    return null;
  }

  const sectionRaw = typeof candidate.section === "string" ? candidate.section : "";
  const section = sectionRaw.trim().toLowerCase();
  if (section !== "monitoring" && section !== "alarm" && section !== "history") {
    return null;
  }

  return {
    busId,
    section,
    group: typeof candidate.group === "string" ? candidate.group : undefined,
    index: candidate.index,
    label: candidate.label,
    value: normalizeValue(candidate.value),
    unit: typeof candidate.unit === "string" ? candidate.unit : undefined,
    writeable: candidate.writeable
  };
}

export async function loadJsonlDataset(): Promise<{ summariesByBusId: Map<number, DeviceSummary>; variables: Variable[] }> {
  const filePath = path.join(process.cwd(), "data", "snapshot_parsed.jsonl");
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const summariesByBusId = new Map<number, DeviceSummary>();
  const variables: Variable[] = [];

  for (const [lineNumber, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const object = JSON.parse(trimmed) as Record<string, unknown>;
      const summary = parseDeviceSummary(object);
      if (summary) {
        const busId = toBusId(object.bus_id);
        if (busId !== null) {
          summariesByBusId.set(busId, summary);
        }
        continue;
      }

      const variable = toTelemetryVariable(object);
      if (variable) {
        variables.push(variable);
      }
    } catch (error) {
      console.warn(`Skipping malformed JSONL line ${lineNumber + 1}`, error);
    }
  }

  return { summariesByBusId, variables };
}

/** One dataset parse per request (deduped). Yacht ownership applied when building devices. */
export const loadJsonlDatasetCached = cache(loadJsonlDataset);

function useJsonlFallback(): boolean {
  const explicitFallback = process.env.NEXT_PUBLIC_USE_JSONL_FALLBACK === "true";
  if (explicitFallback) return true;

  const hasSupabaseEnv = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  return !hasSupabaseEnv;
}

const getSupabaseClient = cache(() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase env missing. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or set NEXT_PUBLIC_USE_JSONL_FALLBACK=true."
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false }
  });
});

function mapSection(section: string): Variable["section"] | null {
  const normalized = section.trim().toLowerCase();
  if (normalized === "monitoring" || normalized === "monitor") return "monitoring";
  if (normalized === "alarm" || normalized === "alarms") return "alarm";
  if (normalized === "history" || normalized === "historical") return "history";
  return null;
}

function toBusIdFromRow(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

type DeviceRow = {
  yacht_id: string;
  bus_id: number | string;
  product_id: string | null;
  display_name: string | null;
  product_name: string | null;
  serial_number: string | null;
  firmware_version: string | null;
  software_version: string | null;
};

type VariableDefinitionRow = {
  product_id: string;
  variable_index: number;
  section: string;
  group_name: string | null;
  label: string;
  unit: string | null;
  writeable: boolean;
};

function mapDeviceRowsToDeviceData(yacht: Yacht, devices: DeviceRow[], definitions: VariableDefinitionRow[]): DeviceData[] {
  const defsByProduct = new Map<string, VariableDefinitionRow[]>();
  for (const row of definitions) {
    if (!defsByProduct.has(row.product_id)) defsByProduct.set(row.product_id, []);
    defsByProduct.get(row.product_id)?.push(row);
  }

  return devices
    .map((device) => {
      const busId = toBusIdFromRow(device.bus_id);
      const productId = device.product_id ?? "__unknown__";
      const productDefs = defsByProduct.get(productId) ?? [];

      const monitoring: Variable[] = [];
      const alarm: Variable[] = [];
      const history: Variable[] = [];

      for (const def of productDefs) {
        const section = mapSection(def.section);
        if (!section) continue;

        const variable: Variable = {
          busId,
          section,
          group: def.group_name ?? undefined,
          index: def.variable_index,
          label: def.label,
          value: null,
          unit: def.unit ?? undefined,
          writeable: def.writeable
        };

        if (section === "monitoring") monitoring.push(variable);
        if (section === "alarm") alarm.push(variable);
        if (section === "history") history.push(variable);
      }

      monitoring.sort((a, b) => a.index - b.index);
      alarm.sort((a, b) => a.index - b.index);
      history.sort((a, b) => a.index - b.index);

      const summary: DeviceSummary = {
        deviceName: device.display_name || `Device ${busId}`,
        productId: device.product_id ?? undefined,
        serialNumber: device.serial_number ?? undefined,
        firmwareVersion: device.firmware_version ?? undefined,
        softwareVersion: device.software_version ?? undefined,
        productName: device.product_name ?? undefined
      };

      return {
        yachtId: yacht.id,
        busId,
        name: summary.deviceName,
        summary,
        monitoring,
        alarm,
        history
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getYachts(): Promise<Yacht[]> {
  if (useJsonlFallback()) {
    return listLocalYachts();
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("yachts").select("id,slug,name").order("name", { ascending: true });
  if (error) throw new Error(`Failed loading yachts: ${error.message}`);
  return (data ?? []) as Yacht[];
}

export async function getYachtBySlug(slug: string): Promise<Yacht | null> {
  if (useJsonlFallback()) {
    return getLocalYachtBySlug(slug) ?? null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("yachts").select("id,slug,name").eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Failed loading yacht '${slug}': ${error.message}`);
  return (data as Yacht | null) ?? null;
}

export async function getDevicesForYacht(yacht: Yacht): Promise<DeviceData[]> {
  if (useJsonlFallback()) {
    if (!usesLocalJsonlDataset(yacht.id)) return [];
    const { summariesByBusId, variables } = await loadJsonlDatasetCached();
    return buildDevices(yacht.id, summariesByBusId, variables);
  }

  const supabase = getSupabaseClient();
  const { data: devicesData, error: devicesError } = await supabase
    .from("devices")
    .select("yacht_id,bus_id,product_id,display_name,product_name,serial_number,firmware_version,software_version")
    .eq("yacht_id", yacht.id)
    .order("bus_id", { ascending: true });

  if (devicesError) {
    throw new Error(`Failed loading devices: ${devicesError.message}`);
  }

  const devices = (devicesData ?? []) as DeviceRow[];
  if (devices.length === 0) return [];

  const productIds = Array.from(
    new Set(
      devices
        .map((d) => (d.product_id && d.product_id.trim() ? d.product_id : "__unknown__"))
        .filter(Boolean)
    )
  );

  let definitions: VariableDefinitionRow[] = [];
  if (productIds.length > 0) {
    const { data: defsData, error: defsError } = await supabase
      .from("variable_definitions")
      .select("product_id,variable_index,section,group_name,label,unit,writeable")
      .in("product_id", productIds);
    if (defsError) throw new Error(`Failed loading variable definitions: ${defsError.message}`);
    definitions = (defsData ?? []) as VariableDefinitionRow[];
  }

  return mapDeviceRowsToDeviceData(yacht, devices, definitions);
}

export async function getDeviceForYacht(yacht: Yacht, deviceBusId: string): Promise<DeviceData | null> {
  const devices = await getDevicesForYacht(yacht);
  const idNum = Number(deviceBusId);
  if (!Number.isFinite(idNum)) {
    return null;
  }
  return devices.find((d) => d.busId === idNum) ?? null;
}

export async function getYachtExplorerStats(yacht: Yacht): Promise<{ deviceCount: number; telemetryVariableCount: number }> {
  const devices = await getDevicesForYacht(yacht);
  const telemetryVariableCount = devices.reduce((sum, d) => sum + countTelemetryVariables(d), 0);
  return { deviceCount: devices.length, telemetryVariableCount };
}

export type GraphDeviceOption = {
  id: string;
  busId: number;
  name: string;
};

export type GraphMetricOption = {
  metricKey: string;
  sampleCount: number;
  firstSeen: string;
  lastSeen: string;
};

export type TelemetryPoint = {
  ts: string;
  value: number;
};

export type TelemetryCurrentPoint = {
  ts: string;
  value: number;
} | null;

function isGraphableMetric(metricKey: string): boolean {
  const lower = metricKey.toLowerCase();
  if (lower.startsWith("installer_menu.")) return false;
  if (lower.startsWith("debug.")) return false;
  if (lower.startsWith("diskstatus.")) return false;
  if (lower.endsWith(".date")) return false;
  if (lower.endsWith(".time")) return false;

  const blocked = new Set([
    "general.date",
    "general.time",
    "general.device_name",
    "general.serial_number",
    "general.product_name",
    "general.software_version",
    "general.firmware_version",
    "general.ip_address",
    "general.mac_address"
  ]);

  return !blocked.has(lower);
}

export async function getTelemetryGraphDevicesForYacht(yacht: Yacht): Promise<GraphDeviceOption[]> {
  if (useJsonlFallback()) {
    const devices = await getDevicesForYacht(yacht);
    return devices.map((device) => ({
      id: String(device.busId),
      busId: device.busId,
      name: device.summary.deviceName
    }));
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("devices")
    .select("id,bus_id,display_name")
    .eq("yacht_id", yacht.id)
    .order("bus_id", { ascending: true });
  if (error) throw new Error(`Failed loading graph devices: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: String(row.id),
    busId: toBusIdFromRow(row.bus_id),
    name: row.display_name || `Device ${toBusIdFromRow(row.bus_id)}`
  }));
}

export async function getGraphableMetricsForDevice(yachtId: string, deviceId: string): Promise<GraphMetricOption[]> {
  if (!yachtId || !deviceId || useJsonlFallback()) return [];

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("telemetry_timeseries")
    .select("metric_key,ts")
    .eq("yacht_id", yachtId)
    .eq("device_id", deviceId)
    .not("numeric_value", "is", null)
    .order("ts", { ascending: false })
    .limit(100000);

  if (error) throw new Error(`Failed loading graphable metrics: ${error.message}`);

  const grouped = new Map<string, GraphMetricOption>();
  for (const row of data ?? []) {
    const metricKey = String(row.metric_key);
    if (!isGraphableMetric(metricKey)) continue;

    const existing = grouped.get(metricKey);
    const ts = String(row.ts);
    if (!existing) {
      grouped.set(metricKey, {
        metricKey,
        sampleCount: 1,
        firstSeen: ts,
        lastSeen: ts
      });
    } else {
      existing.sampleCount += 1;
      if (ts < existing.firstSeen) existing.firstSeen = ts;
      if (ts > existing.lastSeen) existing.lastSeen = ts;
    }
  }

  return Array.from(grouped.values()).sort((a, b) => a.metricKey.localeCompare(b.metricKey));
}

export async function getTelemetryHistory(params: {
  yachtId: string;
  deviceId: string;
  metricKey: string;
  start: string;
  end: string;
  limit?: number;
}): Promise<TelemetryPoint[]> {
  if (useJsonlFallback()) return [];

  const { yachtId, deviceId, metricKey, start, end } = params;
  if (!yachtId || !deviceId || !metricKey || !isGraphableMetric(metricKey)) return [];

  const supabase = getSupabaseClient();
  const limit = Math.min(Math.max(params.limit ?? 5000, 1), 5000);
  const { data, error } = await supabase
    .from("telemetry_timeseries")
    .select("ts,numeric_value")
    .eq("yacht_id", yachtId)
    .eq("device_id", deviceId)
    .eq("metric_key", metricKey)
    .not("numeric_value", "is", null)
    .gte("ts", start)
    .lte("ts", end)
    .order("ts", { ascending: true })
    .limit(limit);

  if (error) throw new Error(`Failed loading telemetry history: ${error.message}`);

  return (data ?? [])
    .filter((row) => typeof row.numeric_value === "number")
    .map((row) => ({ ts: String(row.ts), value: Number(row.numeric_value) }));
}

export async function getTelemetryCurrent(params: {
  yachtId: string;
  deviceId: string;
  metricKey: string;
}): Promise<TelemetryCurrentPoint> {
  if (useJsonlFallback()) return null;

  const { yachtId, deviceId, metricKey } = params;
  if (!yachtId || !deviceId || !metricKey || !isGraphableMetric(metricKey)) return null;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("telemetry_current")
    .select("source_timestamp,numeric_value")
    .eq("yacht_id", yachtId)
    .eq("device_id", deviceId)
    .eq("metric_key", metricKey)
    .not("numeric_value", "is", null)
    .maybeSingle();

  if (error) throw new Error(`Failed loading current telemetry: ${error.message}`);
  if (!data || typeof data.numeric_value !== "number") return null;

  return { ts: String(data.source_timestamp), value: Number(data.numeric_value) };
}
