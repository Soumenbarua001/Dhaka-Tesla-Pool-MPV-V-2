import { routeUnits, type Zone } from "./zones.js";

export const BASE_FARE_PAISA = 4_500; // ৳45
export const PER_ROUTE_UNIT_PAISA = 1_800; // ৳18
export const POOL_DISCOUNT_PERCENT = 20;

export function estimateSoloFare(pickup: Zone, dropoff: Zone): number {
  return BASE_FARE_PAISA + routeUnits(pickup, dropoff) * PER_ROUTE_UNIT_PAISA;
}

export function pooledFare(quotedFarePaisa: number, memberCount: number): number {
  if (memberCount <= 1) return quotedFarePaisa;
  return Math.round((quotedFarePaisa * (100 - POOL_DISCOUNT_PERCENT)) / 100);
}

export function formatPaisa(paisa: number): string {
  return `৳${(paisa / 100).toFixed(2)}`;
}
