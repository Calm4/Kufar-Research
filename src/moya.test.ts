import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMoyaAds } from "./moya";

test("extractMoyaAds reads cards and derives USD with the NBRB rate", () => {
  const html = `
    <div class="one_advert_list" idAds="211420123">
      <div class="title"><a href="/single/ad/211420123">3-ком. квартира</a></div>
      <div class="address">Центральный р-н, ул. Гагарина, д. 40</div>
      <div class="price">1 100 руб.</div>
      <img src="https://media1.moyareklama.by/i/p/medium/one.jpg">
      <img src="https://media1.moyareklama.by/i/p/medium/two.jpg">
      Еще<br>3 фото
    </div>
  `;
  const ad = extractMoyaAds(html, "gomel", 3.2).get("211420123");

  assert.ok(ad);
  assert.equal(ad.source, "moya");
  assert.equal(ad.priceByn, 1100);
  assert.equal(ad.priceUsd, 343.75);
  assert.equal(ad.rooms, 3);
  assert.equal(ad.distanceKm, null);
  assert.equal(ad.photoCount, 5);
  assert.equal(ad.photoUrls.length, 2);
});

test("extractMoyaAds ignores unrelated catalogue cards", () => {
  const html = `
    <div class="one_advert_list" idAds="1">
      <div class="title"><a>Продам велосипед</a></div>
    </div>
  `;
  assert.equal(extractMoyaAds(html, "gomel", 3.2).size, 0);
});
