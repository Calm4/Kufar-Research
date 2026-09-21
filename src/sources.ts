import type { CityConfig, CityId } from "./cities";
import { getCity } from "./cities";
import type { AdDetails, ListingSourceId } from "./hotness";
import { extractAds as extractKufarAds } from "./kufar";
import { extractMoyaAds } from "./moya";
import { extractRealtAds } from "./realt";

export interface FeedDefinition {
  source: ListingSourceId;
  sourceLabel: string;
  sourceIcon: string;
  cityId: CityId;
  url: string;
  extract: (html: string, bynPerUsd: number | null) => Map<string, AdDetails>;
}

export const SOURCE_PRESENTATION: Record<
  ListingSourceId,
  { label: string; icon: string }
> = {
  kufar: { label: "Kufar", icon: "🟣" },
  realt: { label: "Realt", icon: "🔵" },
  moya: { label: "Моя реклама", icon: "🟠" },
};

function kufarUrl(city: CityConfig): string {
  return `https://re.kufar.by/l/${city.kufarSlug}/snyat/kvartiru?cur=USD&size=30`;
}

function realtUrl(city: CityConfig): string {
  return city.realtRegion
    ? `https://realt.by/${city.realtRegion}/rent/flat-for-long/`
    : "https://realt.by/rent/flat-for-long/";
}

function feed(
  source: ListingSourceId,
  cityId: CityId,
  url: string,
  extract: FeedDefinition["extract"]
): FeedDefinition {
  const presentation = SOURCE_PRESENTATION[source];
  return {
    source,
    sourceLabel: presentation.label,
    sourceIcon: presentation.icon,
    cityId,
    url,
    extract,
  };
}

export function getFeedsForCity(cityId: CityId): FeedDefinition[] {
  const city = getCity(cityId);
  const feeds = [
    feed("kufar", city.id, kufarUrl(city), (html) => extractKufarAds(html, city.id)),
    feed("realt", city.id, realtUrl(city), (html) => extractRealtAds(html, city.id)),
  ];

  // moyareklama.by is the Belarus/Gomel edition of the service. Its public
  // catalogue covers Gomel and Gomel region, but not the other five regional
  // capitals selected in the bot.
  if (city.id === "gomel") {
    feeds.push(
      feed(
        "moya",
        city.id,
        "https://www.moyareklama.by/%D0%93%D0%BE%D0%BC%D0%B5%D0%BB%D1%8C/%D1%81%D0%BD%D1%8F%D1%82%D1%8C_%D0%BA%D0%B2%D0%B0%D1%80%D1%82%D0%B8%D1%80%D1%83/",
        (html, bynPerUsd) => extractMoyaAds(html, city.id, bynPerUsd)
      )
    );
  }

  return feeds;
}
