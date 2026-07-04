import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyHotness, haversineKm, formatAdMessage, CITY_CENTER, type AdDetails } from "./hotness";

function ad(overrides: Partial<AdDetails> = {}): AdDetails {
  return {
    id: "1",
    link: "https://re.kufar.by/vi/1",
    priceUsd: null,
    priceByn: null,
    rooms: null,
    address: null,
    distanceKm: null,
    ...overrides,
  };
}

test("haversineKm is ~0 for the same point", () => {
  const d = haversineKm(CITY_CENTER.lat, CITY_CENTER.lng, CITY_CENTER.lat, CITY_CENTER.lng);
  assert.ok(d < 0.001);
});

test("haversineKm gives a sane distance for 1 degree of latitude (~111km)", () => {
  const d = haversineKm(52.0, 31.0, 53.0, 31.0);
  assert.ok(d > 100 && d < 112);
});

test("classifyHotness: cheap + close is green", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 100, rooms: 1, distanceKm: 1 })), "🟢");
});

test("classifyHotness: expensive + far is red", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 900, rooms: 1, distanceKm: 20 })), "🔴");
});

test("classifyHotness: no price/distance data is white", () => {
  assert.equal(classifyHotness(ad()), "⚪");
});

test("classifyHotness: studio (0 rooms) treated as 1 room, not divide-by-zero", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 100, rooms: 0, distanceKm: 1 })), "🟢");
});

test("formatAdMessage shows BYN(USD) when both prices present", () => {
  const msg = formatAdMessage(ad({ priceByn: 300, priceUsd: 100, rooms: 2, distanceKm: 2.7 }));
  assert.match(msg, /300р\(100\$\)/);
  assert.match(msg, /2 комн\./);
  assert.match(msg, /2\.7 км до центра/);
});

test("formatAdMessage falls back to 'Новое объявление' with no data", () => {
  const msg = formatAdMessage(ad());
  assert.match(msg, /Новое объявление/);
});
