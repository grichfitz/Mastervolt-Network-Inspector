const express = require("express");
const { supabase } = require("../config/supabase");
const { ingestSnapshotXml } = require("../../ingest/services/snapshotIngestService");
const { ingestDataloggingTxt } = require("../../ingest/services/telemetryIngestService");

const router = express.Router();

const MAX_HISTORY_LIMIT = 5000;
const DEFAULT_HISTORY_LIMIT = 5000;
const DEFAULT_RANGE_HOURS = 24;

function parseLimit(raw, fallback = DEFAULT_HISTORY_LIMIT) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), MAX_HISTORY_LIMIT);
}

function toIsoOrNull(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function computeTimeRange(startRaw, endRaw) {
  const now = new Date();
  const end = toIsoOrNull(endRaw) ?? now.toISOString();

  const start = toIsoOrNull(startRaw);
  if (start) {
    return { start, end };
  }

  const startDate = new Date(new Date(end).getTime() - DEFAULT_RANGE_HOURS * 60 * 60 * 1000);
  return { start: startDate.toISOString(), end };
}

function isGraphableMetric(metricKey) {
  if (typeof metricKey !== "string" || !metricKey.trim()) return false;

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

async function resolveYachtByKey(yachtKey) {
  if (/^[0-9a-fA-F-]{36}$/.test(yachtKey)) {
    const { data, error } = await supabase.from("yachts").select("id,slug,name").eq("id", yachtKey).single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase.from("yachts").select("id,slug,name").eq("slug", yachtKey).single();
  if (error) throw error;
  return data;
}

router.get("/yachts", async (_req, res, next) => {
  try {
    const { data, error } = await supabase.from("yachts").select("*").order("name", { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/yachts/:yachtKey/devices", async (req, res, next) => {
  try {
    const yacht = await resolveYachtByKey(req.params.yachtKey);
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("yacht_id", yacht.id)
      .order("bus_id", { ascending: true });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/telemetry", async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yachtId === "string" ? req.query.yachtId : "";
    const variableDefinitionId = typeof req.query.variableDefinitionId === "string" ? req.query.variableDefinitionId : "";
    const from = req.query.from;
    const to = req.query.to;
    const limit = Number(req.query.limit || 1000);

    let query = supabase.from("telemetry").select("*").order("timestamp", { ascending: false }).limit(limit);

    if (yachtId) query = query.eq("yacht_id", yachtId);
    if (variableDefinitionId) query = query.eq("variable_definition_id", variableDefinitionId);
    if (from) query = query.gte("timestamp", from);
    if (to) query = query.lte("timestamp", to);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/alarms", async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yachtId === "string" ? req.query.yachtId : "";
    const activeOnly = req.query.active === "true";
    let query = supabase.from("alarm_events").select("*").order("start_time", { ascending: false });

    if (yachtId) query = query.eq("yacht_id", yachtId);
    if (activeOnly) {
      query = query.is("end_time", null);
    }

    const { data, error } = await query;
    if (error) throw error;

    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get("/telemetry/graphable-metrics", async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yacht_id === "string" ? req.query.yacht_id : "";
    const deviceId = typeof req.query.device_id === "string" ? req.query.device_id : "";
    const limit = parseLimit(req.query.limit, 200);

    let query = supabase
      .from("telemetry_timeseries")
      .select("metric_key,ts")
      .not("numeric_value", "is", null)
      .order("ts", { ascending: false })
      .limit(100000);

    if (yachtId) query = query.eq("yacht_id", yachtId);
    if (deviceId) query = query.eq("device_id", deviceId);

    const { data, error } = await query;
    if (error) throw error;

    const grouped = new Map();
    for (const row of data ?? []) {
      if (!isGraphableMetric(row.metric_key)) continue;
      const current = grouped.get(row.metric_key);
      const ts = row.ts;
      if (!current) {
        grouped.set(row.metric_key, { metric_key: row.metric_key, sample_count: 1, first_seen: ts, last_seen: ts });
      } else {
        current.sample_count += 1;
        if (ts < current.first_seen) current.first_seen = ts;
        if (ts > current.last_seen) current.last_seen = ts;
      }
    }

    const result = Array.from(grouped.values())
      .sort((a, b) => a.metric_key.localeCompare(b.metric_key))
      .slice(0, limit);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/telemetry/history", async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yacht_id === "string" ? req.query.yacht_id.trim() : "";
    const deviceId = typeof req.query.device_id === "string" ? req.query.device_id.trim() : "";
    const metricKey = typeof req.query.metric_key === "string" ? req.query.metric_key.trim() : "";

    if (!yachtId || !deviceId || !metricKey) {
      res.status(400).json({ error: "yacht_id, device_id, and metric_key are required." });
      return;
    }

    if (!isGraphableMetric(metricKey)) {
      res.status(400).json({ error: "metric_key is excluded from graphing." });
      return;
    }

    const { start, end } = computeTimeRange(req.query.start, req.query.end);
    const limit = parseLimit(req.query.limit);

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

    if (error) throw error;

    const result = (data ?? []).map((row) => ({
      ts: row.ts,
      value: row.numeric_value
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/telemetry/current", async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yacht_id === "string" ? req.query.yacht_id.trim() : "";
    const deviceId = typeof req.query.device_id === "string" ? req.query.device_id.trim() : "";
    const metricKey = typeof req.query.metric_key === "string" ? req.query.metric_key.trim() : "";

    if (!yachtId || !deviceId || !metricKey) {
      res.status(400).json({ error: "yacht_id, device_id, and metric_key are required." });
      return;
    }

    if (!isGraphableMetric(metricKey)) {
      res.status(400).json({ error: "metric_key is excluded from graphing." });
      return;
    }

    const { data, error } = await supabase
      .from("telemetry_current")
      .select("source_timestamp,numeric_value")
      .eq("yacht_id", yachtId)
      .eq("device_id", deviceId)
      .eq("metric_key", metricKey)
      .not("numeric_value", "is", null)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      res.json(null);
      return;
    }

    res.json({
      ts: data.source_timestamp,
      value: data.numeric_value
    });
  } catch (error) {
    next(error);
  }
});

router.post("/ingest/snapshot", express.text({ type: "*/*" }), async (req, res, next) => {
  try {
    const yachtId = typeof req.query.yachtId === "string" ? req.query.yachtId : "";
    if (!yachtId) {
      res.status(400).json({ error: "Query parameter yachtId (UUID) is required. Yacht must already exist." });
      return;
    }
    const result = await ingestSnapshotXml(req.body, yachtId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post("/ingest/datalogging/:yachtKey", express.text({ type: "*/*" }), async (req, res, next) => {
  try {
    const yacht = await resolveYachtByKey(req.params.yachtKey);
    const result = await ingestDataloggingTxt(yacht.id, req.body);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
