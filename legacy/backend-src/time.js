const { DateTime } = require("luxon");

function toUtcIsoString(input) {
  const parsed = DateTime.fromFormat(input, "yyyy-MM-dd HH:mm:ss", { zone: "local" });
  if (!parsed.isValid) {
    throw new Error(`Invalid timestamp format: ${input}`);
  }
  return parsed.toUTC().toISO();
}

module.exports = { toUtcIsoString };
