import type { CityId } from "./cities";
import { DEFAULT_CITY_ID, getCity } from "./cities";

export type ListingSourceId = "kufar" | "realt" | "moya";

export interface AdDetails {
  id: string;
  source: ListingSourceId;
  cityId: CityId;
  link: string;
  priceUsd: number | null;
  priceByn: number | null;
  exchangeRateBynPerUsd: number | null;
  rooms: number | null;
  address: string | null;
  distanceKm: number | null;
  photoCount: number;
  photoUrls: string[];
}

// Универмаг «Гомель», Советская ул., 60. This is the reference point for
// both the displayed distance and the location part of the hotness score.
export const CITY_CENTER = getCity(DEFAULT_CITY_ID).center;

const SOURCE_LABELS: Record<ListingSourceId, string> = {
  kufar: "Kufar",
  realt: "Realt",
  moya: "Moya",
};

// Hotness is deliberately weighted in this order: price (50%), distance
// (40%), rooms (10%). The constants are kept here so preferences remain easy
// to tune without touching the rest of the monitor.
export const PRICE_BEST_USD = 150;
export const PRICE_GREAT_USD = 200;
export const PRICE_OK_USD = 250;
export const PRICE_MAX_USD = 300;
export const CENTER_CLOSE_KM = 2;
export const CENTER_OK_KM = 5;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function calculateHotnessScore(ad: AdDetails): number | null {
  // Without a real price the primary factor is unknown, so do not pretend the
  // listing has a meaningful rating (Kufar sometimes returns zero-price ads).
  if (ad.priceUsd == null || ad.priceUsd <= 0) return null;

  let score = 0;

  if (ad.priceUsd <= PRICE_BEST_USD) score += 5;
  else if (ad.priceUsd <= PRICE_GREAT_USD) score += 4;
  else if (ad.priceUsd <= PRICE_OK_USD) score += 3;
  else if (ad.priceUsd <= PRICE_MAX_USD) score += 2;

  if (ad.distanceKm != null) {
    if (ad.distanceKm <= CENTER_CLOSE_KM) score += 4;
    else if (ad.distanceKm <= CENTER_OK_KM) score += 2;
  }

  if (ad.rooms != null) {
    if (ad.rooms >= 2) score += 1;
    else if (ad.rooms === 1) score += 0.5;
  }

  return score;
}

export function classifyHotness(ad: AdDetails): "🟢" | "🟡" | "🔴" | "⚪" {
  const score = calculateHotnessScore(ad);
  if (score == null) return "⚪";
  if (score >= 7) return "🟢";
  if (score >= 4) return "🟡";
  return "🔴";
}

function formatNumber(value: number, maximumFractionDigits: number): string {
  const fixed = value.toFixed(maximumFractionDigits);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "").replace(".", ",");
}

function escapeTelegramHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeTelegramHtmlAttribute(value: string): string {
  return escapeTelegramHtml(value).replace(/"/g, "&quot;");
}

function formatRooms(rooms: number | null): string {
  if (rooms == null) return "не указано";
  const keycaps: Record<number, string> = {
    0: "0️⃣",
    1: "1️⃣",
    2: "2️⃣",
    3: "3️⃣",
    4: "4️⃣",
    5: "5️⃣",
    6: "6️⃣",
    7: "7️⃣",
    8: "8️⃣",
    9: "9️⃣",
  };
  return keycaps[rooms] ?? String(rooms);
}

export function formatShortAddress(address: string | null, cityId: CityId = DEFAULT_CITY_ID): string {
  if (!address) return "не указан";

  const cityDisplayName = getCity(cityId).name;
  const cityName = cityDisplayName.toLowerCase();
  const redundantParts = new Set([
    cityName,
    `г. ${cityName}`,
    "гомельская область",
    "минская область",
    "брестская область",
    "гродненская область",
    "витебская область",
    "могилёвская область",
    "могилевская область",
    "беларусь",
    "республика беларусь",
  ]);
  const shortAddress = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !redundantParts.has(part.toLowerCase()))
    .join(", ")
    // Realt sometimes prefixes the city without a separating comma:
    // "Гомель Артиллерийская ул. 4".
    .replace(new RegExp(`^(?:г\\.\\s*)?${cityDisplayName}\\s+`, "iu"), "");

  return (shortAddress || address).replace(/(^|[\s,])ул(?=\s*[,\d]|$)/giu, "$1ул.");
}

export function formatAdMessage(ad: AdDetails): string {
  const circle = classifyHotness(ad);
  let price: string;
  if (ad.priceByn != null && ad.priceUsd != null) {
    price = `${formatNumber(ad.priceByn, 0)}р (${formatNumber(ad.priceUsd, 0)} USD)`;
  } else if (ad.priceByn != null) {
    price = `${formatNumber(ad.priceByn, 0)}р`;
  } else if (ad.priceUsd != null) {
    price = `${formatNumber(ad.priceUsd, 0)} USD`;
  } else {
    price = "не указана";
  }

  const lines = [`${circle}[${SOURCE_LABELS[ad.source]}] Цена: <b>${price}</b>`];
  lines.push(`Адрес: <b>${escapeTelegramHtml(formatShortAddress(ad.address, ad.cityId))}</b>`);
  lines.push(`Кол-во комнат: ${formatRooms(ad.rooms)}`);
  lines.push(
    `Расстояние до Центра: ${
      ad.distanceKm != null ? `${formatNumber(ad.distanceKm, 1)} км` : "не рассчитано"
    }`
  );
  lines.push("");
  lines.push(`📸 Фотографий: ${ad.photoCount > 0 ? ad.photoCount : "нет"}`);
  lines.push(`<a href="${escapeTelegramHtmlAttribute(ad.link)}">Ссылка на объявление</a>`);
  return lines.join("\n");
}
