"use strict";

const { XMLParser } = require("fast-xml-parser");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: ""
});

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textOf(node) {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "#text" in node) return String(node["#text"]);
  return "";
}

function buildStringsMap(device) {
  const strings = asArray(device.strings?.string);
  const map = new Map();
  for (const entry of strings) {
    const num = Number(entry.number);
    const value = textOf(entry).trim();
    if (!Number.isFinite(num)) continue;
    map.set(num, value);
  }
  return map;
}

function formatFirmwareVersion(device) {
  const parts = [];
  const gc = device.GeneralCount;
  const bootVer = textOf(gc?.BootloaderVersion).trim();
  if (bootVer) {
    parts.push(`bootloader ${bootVer}`);
  }

  const bootGeneral = device.BootLoaderGeneral;
  const processors = asArray(bootGeneral?.processor);
  for (const proc of processors) {
    const idx = proc.index;
    const hw = textOf(proc.hw).trim();
    const sw = textOf(proc.sw).trim();
    const label = idx !== undefined && idx !== null ? `proc ${idx}` : "proc";
    if (hw || sw) {
      parts.push(`${label} hw ${hw} sw ${sw}`);
    }
  }

  return parts.length ? parts.join("; ") : null;
}

function resolveSerialNumber(stringsMap, generalString) {
  if (!generalString) return null;
  const raw = textOf(generalString.SerialNumber).trim();
  const sid = Number(raw);
  if (Number.isFinite(sid) && stringsMap.has(sid)) {
    const resolved = stringsMap.get(sid);
    if (resolved) return resolved;
  }
  if (raw) return raw;
  const fallback = stringsMap.get(0);
  return fallback || null;
}

function resolveProductNameString(stringsMap, generalString) {
  if (!generalString) return null;
  const pnRef = Number(textOf(generalString.ProductName));
  if (!Number.isFinite(pnRef)) return null;
  return stringsMap.get(pnRef) || null;
}

function resolveDeviceDisplayName(stringsMap, generalString, productId) {
  const catalog = stringsMap.get(1);
  if (catalog && catalog.trim()) return catalog.trim();

  const productLong = resolveProductNameString(stringsMap, generalString);
  if (productLong && productLong.trim()) return productLong.trim();

  if (productId && String(productId).trim()) return String(productId).trim();

  return null;
}

function parseSnapshotXml(xmlText) {
  const parsed = parser.parse(xmlText);
  const root = parsed.masterbus || parsed.snapshot || parsed;
  const vesselName = root.vessel?.name || root.vesselName || "Unknown Vessel";
  const devicesRaw = asArray(root.devices?.device);

  const devices = devicesRaw
    .map((device) => {
      const stringsMap = buildStringsMap(device);
      const masterbusId = String(device.BusID ?? "").trim();
      if (!masterbusId) return null;

      const generalString = device.GeneralString;
      const bootGeneral = device.BootLoaderGeneral;
      const generalCount = device.GeneralCount;

      const productIdRaw = textOf(bootGeneral?.ProductID).trim();
      const productId = productIdRaw || null;

      const softwareVersionRaw = textOf(generalCount?.SoftwareVersion).trim();
      const softwareVersion = softwareVersionRaw || null;

      const firmwareVersion = formatFirmwareVersion(device);

      const serialNumber = resolveSerialNumber(stringsMap, generalString);
      const productName = resolveProductNameString(stringsMap, generalString);

      const displayName = resolveDeviceDisplayName(stringsMap, generalString, productId) || `Device ${masterbusId}`;

      return {
        masterbusId,
        serialNumber,
        productId,
        productName,
        displayName,
        firmwareVersion,
        softwareVersion,
        role: null
      };
    })
    .filter(Boolean);

  console.log(`snapshot parser extracted ${devices.length} devices`);
  return { vesselName, devices };
}

module.exports = { parseSnapshotXml };
