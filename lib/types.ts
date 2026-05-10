/** Platform tenant — telemetry owner (never inferred from device XML). */
export type Yacht = {
  id: string;
  slug: string;
  name: string;
};

export type Variable = {
  busId: number;
  section: "monitoring" | "alarm" | "history";
  group?: string;
  index: number;
  label: string;
  value: string | number | boolean | null;
  unit?: string;
  writeable: boolean;
};

export type DeviceSummary = {
  deviceName: string;
  productId?: string;
  serialNumber?: string;
  firmwareVersion?: string;
  softwareVersion?: string;
  /** Resolved marketing / catalog product string from snapshot strings table */
  productName?: string;
};

export type DeviceData = {
  /** Owning yacht (platform id; aligns with DB `yachts.external_id` string or bigint-as-string later). */
  yachtId: string;
  /** Stable MasterBus identifier — URL segment `/devices/[deviceId]` */
  busId: number;
  /** Sort/display helper — mirrors summary.deviceName */
  name: string;
  summary: DeviceSummary;
  monitoring: Variable[];
  alarm: Variable[];
  history: Variable[];
};
