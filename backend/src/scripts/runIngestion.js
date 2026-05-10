const fs = require("fs");
const path = require("path");
require("dotenv").config();

const { ingestSnapshotXml } = require("../../ingest/services/snapshotIngestService");
const { ingestDataloggingTxt } = require("../../ingest/services/telemetryIngestService");

async function main() {
  const yachtId = String(process.env.YACHT_ID || "").trim();
  if (!yachtId) {
    throw new Error("Set YACHT_ID to an existing yachts.id UUID before running ingestion (see backend/db/seed_example_yacht.sql).");
  }

  const snapshotPath = path.resolve(__dirname, "../../data/example/snapshot.xml");
  const dataloggingPath = path.resolve(__dirname, "../../data/example/datalogging.txt");

  const snapshotXml = fs.readFileSync(snapshotPath, "utf8");
  const dataloggingTxt = fs.readFileSync(dataloggingPath, "utf8");

  const snapshotResult = await ingestSnapshotXml(snapshotXml, yachtId);
  await ingestDataloggingTxt(snapshotResult.yacht.id, dataloggingTxt);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
