const express = require("express");
const { supabase } = require("../config/supabase");
const { ingestSnapshotXml } = require("../../ingest/services/snapshotIngestService");
const { ingestDataloggingTxt } = require("../../ingest/services/telemetryIngestService");

const router = express.Router();

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
