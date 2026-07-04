import type { AdDetails } from "./hotness";
import { haversineKm, CITY_CENTER } from "./hotness";

// Matches ad links like:
//   /vi/gomel/snyat/kvartiru/123456
//   /vi/gomel/snyat/kvartiru/v-novostrojke/123456
// Used only as a fallback if __NEXT_DATA__ isn't present/parseable.
const AD_LINK_RE = /(\/vi\/(?:[a-z0-9-]+\/){3,4}(\d{5,}))(?![a-z0-9-])/gi;

// Depth-first search for the first array of ad-like objects ({ ad_id, ... })
// anywhere in the Next.js hydration payload. Avoids hardcoding the exact
// nested path (props.pageProps....), which is more likely to shift on a
// Kufar redesign than the shape of an individual ad object.
function findAdsArray(node: unknown, depth = 0): unknown[] | null {
  if (depth > 15 || node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      node.every((el) => el && typeof el === "object" && "ad_id" in (el as object))
    ) {
      return node;
    }
    for (const item of node) {
      const found = findAdsArray(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of Object.keys(node as object)) {
    const found = findAdsArray((node as Record<string, unknown>)[key], depth + 1);
    if (found) return found;
  }
  return null;
}

function getParamValue(params: unknown, key: string): unknown {
  if (!Array.isArray(params)) return null;
  const found = params.find((p) => p && typeof p === "object" && (p as Record<string, unknown>).p === key);
  return found ? (found as Record<string, unknown>).v : null;
}

function buildAdDetails(ad: Record<string, unknown>): AdDetails {
  const id = String(ad.ad_id);

  const roomsRaw = getParamValue(ad.ad_parameters, "rooms");
  const roomsNum = roomsRaw != null ? Number(roomsRaw) : null;
  const rooms = Number.isFinite(roomsNum) ? (roomsNum as number) : null;

  const coords = getParamValue(ad.ad_parameters, "coordinates") as [number, number] | null; // [lng, lat]
  const address = getParamValue(ad.account_parameters, "address") as string | null;

  let priceUsd: number | null = null;
  let priceByn: number | null = null;
  if (Array.isArray(ad.calculator)) {
    const usd = ad.calculator.find((c) => c && (c as Record<string, unknown>).currency === "USD") as
      | Record<string, unknown>
      | undefined;
    if (usd && usd.price != null) priceUsd = Number(usd.price) / 100;
    const byn = ad.calculator.find((c) => c && (c as Record<string, unknown>).currency === "BYN") as
      | Record<string, unknown>
      | undefined;
    if (byn && byn.price != null) priceByn = Number(byn.price) / 100;
  }

  let distanceKm: number | null = null;
  if (Array.isArray(coords) && coords.length === 2) {
    distanceKm = haversineKm(CITY_CENTER.lat, CITY_CENTER.lng, coords[1], coords[0]);
  }

  return {
    id,
    link: (ad.ad_link as string) || `https://re.kufar.by/vi/${id}`,
    priceUsd,
    priceByn,
    rooms,
    address: address || null,
    distanceKm,
  };
}

function extractAdsFromNextData(html: string): Map<string, AdDetails> | null {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const adsArray = findAdsArray(parsed);
  if (!adsArray) return null;

  const byId = new Map<string, AdDetails>();
  for (const ad of adsArray) {
    if (ad && typeof ad === "object" && (ad as Record<string, unknown>).ad_id != null) {
      const details = buildAdDetails(ad as Record<string, unknown>);
      if (!byId.has(details.id)) byId.set(details.id, details);
    }
  }
  return byId;
}

export function extractAds(html: string): Map<string, AdDetails> {
  const rich = extractAdsFromNextData(html);
  if (rich && rich.size > 0) return rich;

  // Fallback: id/link only, no price/rooms/address/distance.
  const unescaped = html.replace(/\\\//g, "/");
  const byId = new Map<string, AdDetails>();
  for (const match of unescaped.matchAll(AD_LINK_RE)) {
    const [, path, id] = match;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        link: `https://re.kufar.by${path}`,
        priceUsd: null,
        priceByn: null,
        rooms: null,
        address: null,
        distanceKm: null,
      });
    }
  }
  return byId;
}

export interface DebugInfo {
  hasNextData: boolean;
  nextDataLength: number;
  firstAdId: string | null;
  adJsonSnippet: string | null;
}

// Standalone debug helper: shows what real ad data looks like inside
// __NEXT_DATA__ so extraction logic can be extended without guessing blind.
export function extractDebugInfo(html: string): DebugInfo {
  const unescaped = html.replace(/\\\//g, "/");

  const nextDataMatch = unescaped.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  const nextData = nextDataMatch ? nextDataMatch[1] : null;

  const idRegex = new RegExp(AD_LINK_RE.source, AD_LINK_RE.flags);
  const firstAdMatch = idRegex.exec(unescaped);
  const firstAdId = firstAdMatch ? firstAdMatch[2] : null;

  let adJsonSnippet: string | null = null;
  if (nextData && firstAdId) {
    const idPos = nextData.indexOf(firstAdId);
    if (idPos !== -1) {
      const start = Math.max(0, idPos - 300);
      const end = Math.min(nextData.length, idPos + 3500);
      adJsonSnippet = nextData.slice(start, end);
    }
  }

  return {
    hasNextData: !!nextData,
    nextDataLength: nextData ? nextData.length : 0,
    firstAdId,
    adJsonSnippet,
  };
}
