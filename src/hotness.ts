export interface AdDetails {
  id: string;
  link: string;
  priceUsd: number | null;
  priceByn: number | null;
  rooms: number | null;
  address: string | null;
  distanceKm: number | null;
}

// Rough Gomel city-center reference point, used only to rank listings by
// proximity for the hotness score below. Approximate — verify/adjust via
// Google/Yandex Maps if it doesn't match your idea of "center".
export const CITY_CENTER = { lat: 52.4245, lng: 31.0017 };

// Hotness thresholds — deliberately simple and tunable. "Price per room" is
// used instead of raw price so a cheap-but-tiny studio doesn't automatically
// outrank a slightly pricier multi-room flat.
export const PRICE_PER_ROOM_GREAT_USD = 120;
export const PRICE_PER_ROOM_OK_USD = 200;
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

export function classifyHotness(ad: AdDetails): "🟢" | "🟡" | "🔴" | "⚪" {
  let score = 0;
  let maxScore = 0;

  if (ad.priceUsd != null && ad.rooms != null) {
    const effectiveRooms = ad.rooms > 0 ? ad.rooms : 1;
    const pricePerRoom = ad.priceUsd / effectiveRooms;
    maxScore += 2;
    if (pricePerRoom <= PRICE_PER_ROOM_GREAT_USD) score += 2;
    else if (pricePerRoom <= PRICE_PER_ROOM_OK_USD) score += 1;
  }

  if (ad.distanceKm != null) {
    maxScore += 2;
    if (ad.distanceKm <= CENTER_CLOSE_KM) score += 2;
    else if (ad.distanceKm <= CENTER_OK_KM) score += 1;
  }

  if (maxScore === 0) return "⚪";
  const ratio = score / maxScore;
  if (ratio >= 0.75) return "🟢";
  if (ratio >= 0.25) return "🟡";
  return "🔴";
}

export function formatAdMessage(ad: AdDetails): string {
  const circle = classifyHotness(ad);
  const parts: string[] = [];
  if (ad.priceByn != null && ad.priceUsd != null) {
    parts.push(`${ad.priceByn.toFixed(0)}р(${ad.priceUsd.toFixed(0)}$)`);
  } else if (ad.priceByn != null) {
    parts.push(`${ad.priceByn.toFixed(0)}р`);
  } else if (ad.priceUsd != null) {
    parts.push(`${ad.priceUsd.toFixed(0)}$`);
  }
  if (ad.rooms != null) parts.push(`${ad.rooms} комн.`);
  if (ad.distanceKm != null) parts.push(`${ad.distanceKm.toFixed(1)} км до центра`);

  const lines = [`${circle} ${parts.join(", ") || "Новое объявление"}`];
  if (ad.address) lines.push(ad.address);
  lines.push(ad.link);
  return lines.join("\n");
}
