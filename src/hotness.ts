export interface AdDetails {
  id: string;
  link: string;
  priceUsd: number | null;
  priceByn: number | null;
  exchangeRateBynPerUsd: number | null;
  rooms: number | null;
  address: string | null;
  distanceKm: number | null;
}

// Универмаг «Гомель», Советская ул., 60. This is the reference point for
// both the displayed distance and the location part of the hotness score.
export const CITY_CENTER = { lat: 52.439338, lng: 31.003331 };

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

function formatExchangeRate(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

export function formatShortAddress(address: string | null): string {
  if (!address) return "не указан";

  const redundantParts = new Set([
    "гомель",
    "г. гомель",
    "гомельская область",
    "беларусь",
    "республика беларусь",
  ]);
  const shortAddress = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !redundantParts.has(part.toLowerCase()))
    .join(", ");

  return shortAddress || address;
}

export function formatAdMessage(ad: AdDetails): string {
  const circle = classifyHotness(ad);
  let price: string;
  if (ad.priceByn != null && ad.priceUsd != null) {
    price = `${formatNumber(ad.priceByn, 0)} BYN (${formatNumber(ad.priceUsd, 0)} USD)`;
  } else if (ad.priceByn != null) {
    price = `${formatNumber(ad.priceByn, 0)} BYN`;
  } else if (ad.priceUsd != null) {
    price = `${formatNumber(ad.priceUsd, 0)} USD`;
  } else {
    price = "не указана";
  }

  const rate =
    ad.exchangeRateBynPerUsd != null
      ? `[1$ = ${formatExchangeRate(ad.exchangeRateBynPerUsd)}Б (по курсу Куфара)]`
      : "";

  const lines = [`${circle} Цена: ${price}`];
  if (rate) lines.push(rate);
  lines.push(`Адрес: ${formatShortAddress(ad.address)}`);
  lines.push(`Кол-во комнат: ${ad.rooms ?? "не указано"}`);
  lines.push(
    `Расстояние до Центра: ${
      ad.distanceKm != null ? `${formatNumber(ad.distanceKm, 1)} км` : "не рассчитано"
    }`
  );
  lines.push(ad.link);
  return lines.join("\n");
}
