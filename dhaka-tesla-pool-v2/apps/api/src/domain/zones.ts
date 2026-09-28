export const ZONES = [
  "Banani",
  "Gulshan 1",
  "Gulshan 2",
  "Mohakhali",
  "Dhanmondi",
  "Mirpur",
  "Uttara",
  "Farmgate",
  "Bashundhara",
] as const;

export type Zone = (typeof ZONES)[number];

export const ZONE_META: Record<Zone, { lat: number; lng: number; corridor: string }> = {
  Banani: { lat: 23.7936, lng: 90.4043, corridor: "north-central" },
  "Gulshan 1": { lat: 23.7806, lng: 90.4158, corridor: "north-central" },
  "Gulshan 2": { lat: 23.7925, lng: 90.4078, corridor: "north-central" },
  Mohakhali: { lat: 23.7779, lng: 90.3991, corridor: "north-central" },
  Dhanmondi: { lat: 23.7461, lng: 90.3742, corridor: "west-central" },
  Mirpur: { lat: 23.8223, lng: 90.3654, corridor: "north-west" },
  Uttara: { lat: 23.8759, lng: 90.3795, corridor: "north-west" },
  Farmgate: { lat: 23.758, lng: 90.39, corridor: "west-central" },
  Bashundhara: { lat: 23.8221, lng: 90.4267, corridor: "north-central" },
};

const ROUTE_UNITS: Record<string, number> = {
  "Banani|Mohakhali": 2,
  "Banani|Gulshan 1": 1,
  "Banani|Gulshan 2": 1,
  "Banani|Bashundhara": 3,
  "Banani|Farmgate": 4,
  "Banani|Uttara": 5,
  "Banani|Mirpur": 5,
  "Banani|Dhanmondi": 6,
};

export function isZone(value: unknown): value is Zone {
  return typeof value === "string" && (ZONES as readonly string[]).includes(value);
}

function haversineKm(a: Zone, b: Zone): number {
  const p = ZONE_META[a];
  const q = ZONE_META[b];
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(q.lat - p.lat);
  const dLng = toRad(q.lng - p.lng);
  const lat1 = toRad(p.lat);
  const lat2 = toRad(q.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function routeUnits(a: Zone, b: Zone): number {
  const direct = ROUTE_UNITS[`${a}|${b}`] ?? ROUTE_UNITS[`${b}|${a}`];
  if (direct) return direct;
  return Math.max(1, Math.ceil(haversineKm(a, b) / 2));
}

export function routesAreCompatible(
  existingPickup: Zone,
  existingDropoffs: Zone[],
  pickup: Zone,
  dropoff: Zone,
): boolean {
  if (existingPickup !== pickup) return false;
  const corridor = ZONE_META[dropoff].corridor;
  return existingDropoffs.every((zone) => ZONE_META[zone].corridor === corridor);
}
