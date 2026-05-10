import { DeviceData, DeviceSummary, Variable } from "@/lib/types";

export type TelemetrySection = Exclude<Variable["section"], never>;

const TELEMETRY_SECTIONS: TelemetrySection[] = ["monitoring", "alarm", "history"];

function emptySummary(busId: number): DeviceSummary {
  return {
    deviceName: `Device ${busId}`
  };
}

function normalizeTelemetrySection(section: string | undefined): TelemetrySection | null {
  if (!section) return null;
  const key = section.trim().toLowerCase();
  if (key === "monitor" || key === "monitoring") return "monitoring";
  if (key === "alarm" || key === "alarms") return "alarm";
  if (key === "history" || key === "historical") return "history";
  return null;
}

export function buildDevices(yachtId: string, summariesByBusId: Map<number, DeviceSummary>, variables: Variable[]): DeviceData[] {
  const byBus = new Map<number, DeviceData>();

  const ensureDevice = (busId: number) => {
    if (!byBus.has(busId)) {
      const summary = summariesByBusId.get(busId) ?? emptySummary(busId);
      byBus.set(busId, {
        yachtId,
        busId,
        name: summary.deviceName,
        summary,
        monitoring: [],
        alarm: [],
        history: []
      });
    }
    return byBus.get(busId)!;
  };

  for (const busId of summariesByBusId.keys()) {
    ensureDevice(busId);
  }

  for (const variable of variables) {
    const section = normalizeTelemetrySection(variable.section);
    if (!section) {
      continue;
    }

    const device = ensureDevice(variable.busId);
    device[section].push({
      ...variable,
      section
    });
  }

  return Array.from(byBus.values())
    .map((device) => ({
      ...device,
      monitoring: device.monitoring.sort((a, b) => a.index - b.index),
      alarm: device.alarm.sort((a, b) => a.index - b.index),
      history: device.history.sort((a, b) => a.index - b.index)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function getDeviceTelemetrySections(device: DeviceData): Array<{ name: TelemetrySection; count: number }> {
  return TELEMETRY_SECTIONS.map((name) => ({
    name,
    count: device[name].length
  }));
}

export function countTelemetryVariables(device: DeviceData): number {
  return device.monitoring.length + device.alarm.length + device.history.length;
}
