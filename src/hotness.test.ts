import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateHotnessScore,
  classifyHotness,
  haversineKm,
  formatAdMessage,
  formatShortAddress,
  CITY_CENTER,
  type AdDetails,
} from "./hotness";

function ad(overrides: Partial<AdDetails> = {}): AdDetails {
  return {
    id: "1",
    source: "kufar",
    cityId: "gomel",
    link: "https://re.kufar.by/vi/1",
    priceUsd: null,
    priceByn: null,
    exchangeRateBynPerUsd: null,
    rooms: null,
    address: null,
    distanceKm: null,
    photoCount: 0,
    photoUrls: [],
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

test("classifyHotness: good price + close + 2 rooms is green", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 300, rooms: 2, distanceKm: 1 })), "🟢");
});

test("classifyHotness: expensive + far is red", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 900, rooms: 1, distanceKm: 20 })), "🔴");
});

test("classifyHotness: a missing price cannot get a rating", () => {
  assert.equal(classifyHotness(ad({ rooms: 3, distanceKm: 0.5 })), "⚪");
});

test("classifyHotness: a great price remains important even far away", () => {
  assert.equal(classifyHotness(ad({ priceUsd: 200, rooms: 1, distanceKm: 10 })), "🟡");
});

test("calculateHotnessScore applies 50/40/10 weights and every price boundary", () => {
  assert.equal(calculateHotnessScore(ad({ priceUsd: 150, rooms: 2, distanceKm: 2 })), 10);
  assert.equal(calculateHotnessScore(ad({ priceUsd: 200, rooms: 2, distanceKm: 5 })), 7);
  assert.equal(calculateHotnessScore(ad({ priceUsd: 250, rooms: 1, distanceKm: 5 })), 5.5);
  assert.equal(calculateHotnessScore(ad({ priceUsd: 300, rooms: 2, distanceKm: 2 })), 7);
  assert.equal(calculateHotnessScore(ad({ priceUsd: 301, rooms: 2, distanceKm: 5 })), 3);
});

test("formatAdMessage uses the compact Telegram layout without the exchange rate", () => {
  const msg = formatAdMessage(
    ad({
      priceByn: 650,
      priceUsd: 211.09,
      exchangeRateBynPerUsd: 650 / 211.09,
      rooms: 2,
      distanceKm: 2.7,
      address: "Ильича & Ко <дом>, 85, Гомель",
    })
  );
  assert.match(msg, /^🟡\[Kufar\] Цена: <b>650р \(211 USD\)<\/b>$/m);
  assert.doesNotMatch(msg, /курс Kufar/);
  assert.match(msg, /^Адрес: <b>Ильича &amp; Ко &lt;дом&gt;, 85<\/b>$/m);
  assert.match(msg, /^Кол-во комнат: 2️⃣$/m);
  assert.match(msg, /^Расстояние до Центра: 2,7 км$/m);
  assert.match(msg, /Расстояние до Центра: 2,7 км\n\n📸 Фотографий: нет/);
  assert.match(msg, /^<a href="https:\/\/re\.kufar\.by\/vi\/1">Ссылка на объявление<\/a>$/m);
});

test("formatAdMessage has readable fallbacks when rich data is missing", () => {
  const msg = formatAdMessage(ad());
  assert.match(msg, /^⚪\[Kufar\] Цена: <b>не указана<\/b>$/m);
  assert.match(msg, /^Адрес: <b>не указан<\/b>$/m);
  assert.match(msg, /^Кол-во комнат: не указано$/m);
  assert.match(msg, /^Расстояние до Центра: не рассчитано$/m);
  assert.match(msg, /^📸 Фотографий: нет$/m);
  assert.doesNotMatch(msg, /Объявление с:/);
});

test("formatShortAddress removes redundant Gomel location parts", () => {
  assert.equal(
    formatShortAddress("Ветковская ул, 2, Гомель, Гомельская область"),
    "Ветковская ул., 2"
  );
  assert.equal(formatShortAddress("3-я Авиационная ул, Гомель"), "3-я Авиационная ул.");
  assert.equal(formatShortAddress("Гомель Артиллерийская ул. 4"), "Артиллерийская ул. 4");
});

test("formatAdMessage shows the full photo count", () => {
  const msg = formatAdMessage(ad({ photoCount: 15, photoUrls: ["https://example.com/1.jpg"] }));
  assert.match(msg, /^📸 Фотографий: 15$/m);
});

test("formatAdMessage puts every source in the first line", () => {
  assert.match(formatAdMessage(ad({ source: "realt" })), /^⚪\[Realt\] Цена:/);
  assert.match(formatAdMessage(ad({ source: "moya" })), /^⚪\[Moya\] Цена:/);
});
