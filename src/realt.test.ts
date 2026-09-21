import { test } from "node:test";
import assert from "node:assert/strict";
import { extractRealtAds } from "./realt";

function nextDataHtml(objects: unknown[]): string {
  return `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { listing: { objects } } },
  })}</script>`;
}

test("extractRealtAds reads listing details, coordinates and photos", () => {
  const ads = extractRealtAds(
    nextDataHtml([
      {
        code: 4232519,
        priceRates: { 840: 330, 933: 1000 },
        rooms: 2,
        address: "Гомель Артиллерийская ул. 4",
        location: [31.003331, 52.439338],
        images: ["https://cdn.realt.by/one", "https://cdn.realt.by/two"],
      },
    ]),
    "gomel"
  );

  const ad = ads.get("4232519");
  assert.ok(ad);
  assert.equal(ad.source, "realt");
  assert.equal(ad.cityId, "gomel");
  assert.equal(ad.priceUsd, 330);
  assert.equal(ad.priceByn, 1000);
  assert.equal(ad.rooms, 2);
  assert.ok(ad.distanceKm != null && ad.distanceKm < 0.001);
  assert.equal(ad.photoCount, 2);
  assert.equal(ad.link, "https://realt.by/gomel-region/rent-flat-for-long/object/4232519/");
});

test("extractRealtAds returns an empty map for invalid hydration data", () => {
  assert.equal(extractRealtAds("<html>no data</html>", "minsk").size, 0);
  assert.equal(
    extractRealtAds('<script id="__NEXT_DATA__">not-json</script>', "minsk").size,
    0
  );
});
