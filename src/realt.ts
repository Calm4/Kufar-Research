import type { CityId } from "./cities";
import { getCity } from "./cities";
import type { AdDetails } from "./hotness";
import { haversineKm } from "./hotness";

function findObjectsArray(node: unknown, depth = 0): unknown[] | null {
  if (depth > 15 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every(
        (item) =>
          item != null &&
          typeof item === "object" &&
          "code" in item &&
          ("priceRates" in item || "address" in item)
      )
    ) {
      return node;
    }
    for (const item of node) {
      const found = findObjectsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findObjectsArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function positiveNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function objectLink(cityId: CityId, code: string): string {
  const region = getCity(cityId).realtRegion;
  const prefix = region ? `/${region}` : "";
  return `https://realt.by${prefix}/rent-flat-for-long/object/${code}/`;
}

function buildAdDetails(raw: Record<string, unknown>, cityId: CityId): AdDetails | null {
  const code = raw.code;
  if (code == null) return null;
  const id = String(code);
  const priceRates =
    raw.priceRates && typeof raw.priceRates === "object"
      ? (raw.priceRates as Record<string, unknown>)
      : {};
  const priceUsd = positiveNumber(priceRates["840"]);
  const priceByn = positiveNumber(priceRates["933"]);

  let distanceKm: number | null = null;
  if (
    Array.isArray(raw.location) &&
    raw.location.length === 2 &&
    Number.isFinite(Number(raw.location[0])) &&
    Number.isFinite(Number(raw.location[1]))
  ) {
    const center = getCity(cityId).center;
    distanceKm = haversineKm(center.lat, center.lng, Number(raw.location[1]), Number(raw.location[0]));
  }

  const photoUrls = Array.isArray(raw.images)
    ? [...new Set(raw.images.filter((url): url is string => typeof url === "string" && /^https:\/\//.test(url)))]
    : [];

  return {
    id,
    source: "realt",
    cityId,
    link: objectLink(cityId, id),
    priceUsd,
    priceByn,
    exchangeRateBynPerUsd:
      priceByn != null && priceUsd != null ? priceByn / priceUsd : null,
    rooms: positiveNumber(raw.rooms),
    address: typeof raw.address === "string" && raw.address.trim() ? raw.address : null,
    distanceKm,
    photoCount: photoUrls.length,
    photoUrls,
  };
}

export function extractRealtAds(html: string, cityId: CityId): Map<string, AdDetails> {
  const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(nextDataMatch[1]);
  } catch {
    return new Map();
  }

  const objects = findObjectsArray(parsed);
  if (!objects) return new Map();

  const result = new Map<string, AdDetails>();
  for (const raw of objects) {
    if (!raw || typeof raw !== "object") continue;
    const ad = buildAdDetails(raw as Record<string, unknown>, cityId);
    if (ad && !result.has(ad.id)) result.set(ad.id, ad);
  }
  return result;
}
