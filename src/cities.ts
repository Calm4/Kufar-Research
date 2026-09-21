export type CityId = "minsk" | "gomel" | "brest" | "grodno" | "vitebsk" | "mogilev";

export interface CityConfig {
  id: CityId;
  name: string;
  aliases: string[];
  center: { lat: number; lng: number };
  kufarSlug: string;
  realtRegion: string | null;
}

export const DEFAULT_CITY_ID: CityId = "gomel";

// The reference points are stable central landmarks. Gomel deliberately
// keeps the previously agreed department-store point; the other cities use
// their central square so the distance score has the same meaning everywhere.
export const CITIES: readonly CityConfig[] = [
  {
    id: "minsk",
    name: "Минск",
    aliases: ["минск", "minsk"],
    center: { lat: 53.9022, lng: 27.5618 },
    kufarSlug: "minsk",
    realtRegion: null,
  },
  {
    id: "gomel",
    name: "Гомель",
    aliases: ["гомель", "gomel", "homel"],
    center: { lat: 52.439338, lng: 31.003331 },
    kufarSlug: "gomel",
    realtRegion: "gomel-region",
  },
  {
    id: "brest",
    name: "Брест",
    aliases: ["брест", "brest"],
    center: { lat: 52.0937, lng: 23.6848 },
    kufarSlug: "brest",
    realtRegion: "brest-region",
  },
  {
    id: "grodno",
    name: "Гродно",
    aliases: ["гродно", "grodno", "hrodna"],
    center: { lat: 53.6789, lng: 23.8298 },
    kufarSlug: "grodno",
    realtRegion: "grodno-region",
  },
  {
    id: "vitebsk",
    name: "Витебск",
    aliases: ["витебск", "vitebsk"],
    center: { lat: 55.1848, lng: 30.2029 },
    kufarSlug: "vitebsk",
    realtRegion: "vitebsk-region",
  },
  {
    id: "mogilev",
    name: "Могилёв",
    aliases: ["могилёв", "могилев", "mogilev", "mahilyow"],
    center: { lat: 53.9095, lng: 30.3429 },
    kufarSlug: "mogilev",
    realtRegion: "mogilev-region",
  },
];

export function getCity(id: CityId | string | undefined): CityConfig {
  return CITIES.find((city) => city.id === id) ?? CITIES.find((city) => city.id === DEFAULT_CITY_ID)!;
}

export function parseCity(value: string): CityConfig | null {
  const normalized = value.trim().toLocaleLowerCase("ru-RU");
  return CITIES.find((city) => city.id === normalized || city.aliases.includes(normalized)) ?? null;
}
