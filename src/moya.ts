import type { CityId } from "./cities";
import type { AdDetails } from "./hotness";

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    sup2: "²",
    lt: "<",
    gt: ">",
  };
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z0-9]+);/gi, (_match, entity: string) => {
      if (entity.startsWith("#x")) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      return named[entity.toLowerCase()] ?? `&${entity};`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function capture(segment: string, pattern: RegExp): string | null {
  const match = segment.match(pattern);
  return match ? decodeHtml(match[1]) : null;
}

function parsePrice(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/([\d\s]+(?:[.,]\d+)?)\s*(?:р\.|руб)/i);
  if (!match) return null;
  const number = Number(match[1].replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function cardSegments(html: string): string[] {
  const markers = [...html.matchAll(/<div class="one_advert_list\b/gi)].map((match) => match.index!);
  return markers.map((start, index) => html.slice(start, markers[index + 1] ?? html.length));
}

export function extractMoyaAds(
  html: string,
  cityId: CityId,
  bynPerUsd: number | null
): Map<string, AdDetails> {
  const result = new Map<string, AdDetails>();

  for (const segment of cardSegments(html)) {
    const idMatch = segment.match(/\bidAds="(\d+)"/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    const title = capture(segment, /<div class="title">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (!title || !/(?:\d+-ком\.|студия)/i.test(title)) continue;

    const roomsMatch = title.match(/(\d+)-ком\./i);
    const rooms = roomsMatch ? Number(roomsMatch[1]) : /студия/i.test(title) ? 1 : null;
    const address = capture(segment, /<div class="address">([\s\S]*?)<\/div>/i);
    const priceByn = parsePrice(capture(segment, /<div class="price">([\s\S]*?)<\/div>/i));
    const photoUrls = [
      ...new Set(
        [...segment.matchAll(/https:\/\/media\d+\.moyareklama\.by\/[^'"\s)]+/gi)].map(
          (match) => match[0]
        )
      ),
    ];
    const moreMatch = segment.match(/Еще\s*<br>\s*(\d+)\s*фото/i) ?? segment.match(/Еще\s*(\d+)\s*фото/i);
    const hiddenPhotoCount = moreMatch ? Number(moreMatch[1]) : 0;
    const photoCount = photoUrls.length > 0 ? photoUrls.length + hiddenPhotoCount : 0;

    result.set(id, {
      id,
      source: "moya",
      cityId,
      link: `https://www.moyareklama.by/single/ad/${id}`,
      priceUsd: priceByn != null && bynPerUsd != null && bynPerUsd > 0 ? priceByn / bynPerUsd : null,
      priceByn,
      exchangeRateBynPerUsd: bynPerUsd,
      rooms,
      address,
      distanceKm: null,
      photoCount,
      photoUrls,
    });
  }

  return result;
}
