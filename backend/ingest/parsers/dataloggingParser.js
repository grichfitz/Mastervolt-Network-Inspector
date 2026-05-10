"use strict";

function parseDataloggingTxt(txt) {
  const lines = txt.split("\n").map((l) => l.trim());
  if (lines.length < 6) return [];

  const header2 = lines[1].split("\t");
  const header5 = lines[4].split("\t");
  const records = [];

  for (let i = 5; i < lines.length; i++) {
    const row = lines[i].split("\t");
    if (row.length < 2) continue;

    const timestampRaw = row[0];
    if (!timestampRaw) continue;

    const timestamp = new Date(timestampRaw);
    if (Number.isNaN(timestamp.getTime())) continue;

    for (let col = 1; col < row.length; col++) {
      const value = row[col];
      if (value === null || value === undefined || value === "" || value === "---") continue;

      records.push({
        timestamp: timestamp.toISOString(),
        columnIndex: col,
        deviceName: header2[col] || "",
        readOnlyIndex: col - 1,
        rawKey: header5[col] || "",
        value
      });
    }
  }

  console.log("datalogging parser extracted", records.length, "datapoints");
  return records;
}

module.exports = { parseDataloggingTxt };
