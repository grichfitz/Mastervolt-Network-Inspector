"use strict";

const { supabase } = require("../../src/config/supabase");
const { parseSnapshotXml } = require("../parsers/snapshotParser");

async function ingestSnapshotXml(xmlText, yachtId) {
  const id = String(yachtId || "").trim();
  if (!id) {
    throw new Error("Invalid yachtId");
  }

  const snapshot = parseSnapshotXml(xmlText);
  const { data: yacht, error: yachtError } = await supabase.from("yachts").select("id,slug,name").eq("id", id).single();
  if (yachtError) throw yachtError;

  if (snapshot.devices.length === 0) {
    return { yacht, devices: [], snapshotVesselLabel: snapshot.vesselName };
  }

  const { data: existingDevices, error: existingDevicesError } = await supabase.from("devices").select("*").eq("yacht_id", yacht.id);
  if (existingDevicesError) throw existingDevicesError;

  const existingByBusId = new Map(existingDevices.map((device) => [String(device.bus_id), device]));

  const coalesce = (nextValue, prevValue) => {
    if (nextValue === null || nextValue === undefined) return prevValue ?? null;
    if (typeof nextValue === "string" && nextValue.trim() === "") return prevValue ?? null;
    return nextValue;
  };

  const deviceRows = snapshot.devices.map((device) => {
    const busId = Number(device.masterbusId);
    const existing = existingByBusId.get(String(busId));
    return {
      yacht_id: yacht.id,
      bus_id: Number.isFinite(busId) ? busId : 0,
      product_id: coalesce(device.productId, existing?.product_id),
      product_name: coalesce(device.productName, existing?.product_name),
      display_name: coalesce(device.displayName, existing?.display_name),
      serial_number: coalesce(device.serialNumber, existing?.serial_number),
      firmware_version: coalesce(device.firmwareVersion, existing?.firmware_version),
      software_version: coalesce(device.softwareVersion, existing?.software_version),
      updated_at: new Date().toISOString()
    };
  });

  const { data: devices, error: deviceError } = await supabase
    .from("devices")
    .upsert(deviceRows, { onConflict: "yacht_id,bus_id" })
    .select("*");
  if (deviceError) throw deviceError;

  return { yacht, devices, snapshotVesselLabel: snapshot.vesselName };
}

module.exports = { ingestSnapshotXml };
