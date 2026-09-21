import { test } from "node:test";
import assert from "node:assert/strict";
import { CITIES, parseCity } from "./cities";
import { getFeedsForCity } from "./sources";

test("the city selector supports the six agreed regional capitals", () => {
  assert.deepEqual(
    CITIES.map((city) => city.name),
    ["Минск", "Гомель", "Брест", "Гродно", "Витебск", "Могилёв"]
  );
  assert.equal(parseCity("могилев")?.id, "mogilev");
  assert.equal(parseCity("HOMEL")?.id, "gomel");
  assert.equal(parseCity("неизвестный")?.id, undefined);
});

test("Kufar and Realt cover every city while Moya covers Gomel", () => {
  for (const city of CITIES) {
    const feeds = getFeedsForCity(city.id);
    assert.ok(feeds.some((feed) => feed.source === "kufar"));
    assert.ok(feeds.some((feed) => feed.source === "realt"));
    assert.equal(feeds.some((feed) => feed.source === "moya"), city.id === "gomel");
    assert.ok(feeds.every((feed) => feed.cityId === city.id));
  }
});
