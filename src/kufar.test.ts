import { test } from "node:test";
import assert from "node:assert/strict";
import { extractAds, extractDebugInfo } from "./kufar";

function nextDataHtml(ads: unknown[]): string {
  const payload = { props: { pageProps: { initialState: { listing: { ads } } } } };
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(
    payload
  )}</script></body></html>`;
}

const sampleAd = {
  ad_id: 1075685401,
  ad_link: "https://re.kufar.by/vi/gomel/snyat/kvartiru/1075685401",
  ad_parameters: [
    { p: "rooms", v: "2" },
    { p: "coordinates", v: [31.0017, 52.4245] },
  ],
  account_parameters: [{ p: "address", v: "3-я Авиационная ул, 9, Гомель" }],
  calculator: [
    { currency: "USD", price: 10000 },
    { currency: "BYN", price: 30000 },
  ],
};

test("extractAds parses a real-shaped __NEXT_DATA__ payload", () => {
  const html = nextDataHtml([sampleAd]);
  const ads = extractAds(html);
  assert.equal(ads.size, 1);
  const ad = ads.get("1075685401");
  assert.ok(ad);
  assert.equal(ad?.rooms, 2);
  assert.equal(ad?.priceUsd, 100);
  assert.equal(ad?.priceByn, 300);
  assert.equal(ad?.address, "3-я Авиационная ул, 9, Гомель");
  assert.ok(ad?.distanceKm !== null && ad!.distanceKm! < 1);
});

test("extractAds dedupes repeated ad_id entries", () => {
  const html = nextDataHtml([sampleAd, sampleAd]);
  const ads = extractAds(html);
  assert.equal(ads.size, 1);
});

test("extractAds falls back to regex when __NEXT_DATA__ is missing", () => {
  const html = `
    <a href="/vi/gomel/snyat/kvartiru/123456">ad 1</a>
    <a href="/vi/gomel/snyat/kvartiru/v-novostrojke/234567">ad 2</a>
  `;
  const ads = extractAds(html);
  assert.equal(ads.size, 2);
  assert.ok(ads.has("123456"));
  assert.ok(ads.has("234567"));
  assert.equal(ads.get("123456")?.priceUsd, null);
});

test("extractAds returns empty map for unrecognizable HTML", () => {
  const ads = extractAds("<html><body>nothing here</body></html>");
  assert.equal(ads.size, 0);
});

test("extractDebugInfo reports whether __NEXT_DATA__ was found", () => {
  const withData = extractDebugInfo(nextDataHtml([sampleAd]));
  assert.equal(withData.hasNextData, true);
  assert.equal(withData.firstAdId, "1075685401");

  const without = extractDebugInfo("<html></html>");
  assert.equal(without.hasNextData, false);
  assert.equal(without.firstAdId, null);
});
