/**
 * Google Ads API v20 metrics helpers (protobuf types use numeric micros).
 */
export function microsToUnits(micros: string | number | null | undefined): number {
  if (micros === undefined || micros === null) return 0;
  return Number(micros) / 1_000_000;
}

export function conversionRateFromMetrics(m: {
  conversions_from_interactions_rate?: number | null;
} | null | undefined): number {
  return m?.conversions_from_interactions_rate ?? 0;
}
