"use strict";

const { supabase } = require("../../src/config/supabase");
const { parseDataloggingTxt } = require("../parsers/dataloggingParser");

function normalize(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^(bat|chg|inv|com)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildColumnDeviceMap(records, devices) {
  const map = new Map();
  if (!records.length || !devices.length) return map;

  const lookup = new Map();
  for (const d of devices) {
    const key = normalize(d.product_name);
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(d);
  }

  const seen = new Set();
  for (const r of records) {
    if (seen.has(r.columnIndex)) continue;
    seen.add(r.columnIndex);
    const candidates = lookup.get(normalize(r.deviceName)) || [];
    if (candidates.length > 0) map.set(r.columnIndex, candidates[0]);
  }
  return map;
}

async function resolveVariableDefinition(rawKey) {
  const { data } = await supabase.from("variable_definitions").select("id,is_alarm").eq("raw_key", rawKey).maybeSingle();
  if (!data) return { variableDefinitionId: null, isAlarm: false };
  return { variableDefinitionId: data.id, isAlarm: Boolean(data.is_alarm) };
}

async function ingestDataloggingTxt(yachtId, txt) {
  const records = parseDataloggingTxt(txt);
  const { data: devices } = await supabase.from("devices").select("id,product_name,product_id").eq("yacht_id", yachtId);
  const deviceMap = buildColumnDeviceMap(records, devices || []);

  const batch = [];
  let rowsInserted = 0;

  for (const r of records) {
    const device = deviceMap.get(r.columnIndex);
    if (!device) continue;

    const { variableDefinitionId, isAlarm } = await resolveVariableDefinition(r.rawKey);
    if (isAlarm) continue;

    batch.push({
      timestamp: r.timestamp,
      yacht_id: yachtId,
      device_id: device.id,
      variable_definition_id: variableDefinitionId,
      read_only_index: r.readOnlyIndex,
      raw_key: r.rawKey,
      value: r.value
    });
    rowsInserted++;

    if (batch.length >= 500) {
      await supabase.from("telemetry").upsert(batch, { onConflict: "timestamp,device_id,read_only_index" });
      batch.length = 0;
    }
  }

  if (batch.length) {
    await supabase.from("telemetry").upsert(batch, { onConflict: "timestamp,device_id,read_only_index" });
  }

  console.log("rows_inserted:", rowsInserted);
}

module.exports = { ingestDataloggingTxt };
