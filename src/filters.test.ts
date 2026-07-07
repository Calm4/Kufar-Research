import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesFilter } from "./filters";
import type { AdDetails } from "./hotness";
import type { Subscriber } from "./subscribers";

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

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return { chatId: "1", ...overrides };
}

test("no filters set: everything passes", () => {
  assert.equal(matchesFilter(ad({ priceUsd: 999, rooms: 5 }), sub()), true);
});

test("price below a single range's min is rejected", () => {
  assert.equal(matchesFilter(ad({ priceUsd: 90 }), sub({ priceRanges: [{ min: 100 }] })), false);
});

test("price above a single range's max is rejected", () => {
  assert.equal(matchesFilter(ad({ priceUsd: 400 }), sub({ priceRanges: [{ max: 300 }] })), false);
});

test("price within a single [min, max] range passes", () => {
  assert.equal(matchesFilter(ad({ priceUsd: 200 }), sub({ priceRanges: [{ min: 100, max: 300 }] })), true);
});

test("missing price always passes a price filter", () => {
  assert.equal(matchesFilter(ad({ priceUsd: null }), sub({ priceRanges: [{ min: 100, max: 300 }] })), true);
});

test("multiple price ranges: price matching any one of them passes", () => {
  const subscriber = sub({ priceRanges: [{ max: 200 }, { min: 600 }] });
  assert.equal(matchesFilter(ad({ priceUsd: 150 }), subscriber), true);
  assert.equal(matchesFilter(ad({ priceUsd: 700 }), subscriber), true);
  assert.equal(matchesFilter(ad({ priceUsd: 400 }), subscriber), false);
});

test("empty priceRanges array is treated as no filter", () => {
  assert.equal(matchesFilter(ad({ priceUsd: 999 }), sub({ priceRanges: [] })), true);
});

test("rooms filter rejects a room count not in the list", () => {
  assert.equal(matchesFilter(ad({ rooms: 3 }), sub({ rooms: [1, 2] })), false);
});

test("rooms filter accepts a room count in the list", () => {
  assert.equal(matchesFilter(ad({ rooms: 2 }), sub({ rooms: [1, 2] })), true);
});

test("missing rooms always passes a rooms filter", () => {
  assert.equal(matchesFilter(ad({ rooms: null }), sub({ rooms: [1, 2] })), true);
});

test("empty rooms array is treated as no filter", () => {
  assert.equal(matchesFilter(ad({ rooms: 7 }), sub({ rooms: [] })), true);
});

test("rooms bucket 4 ('4+') matches 4, 5, and more rooms", () => {
  const subscriber = sub({ rooms: [4] });
  assert.equal(matchesFilter(ad({ rooms: 4 }), subscriber), true);
  assert.equal(matchesFilter(ad({ rooms: 6 }), subscriber), true);
  assert.equal(matchesFilter(ad({ rooms: 3 }), subscriber), false);
});

test("combined price and rooms filter: both must pass", () => {
  const subscriber = sub({ priceRanges: [{ min: 100, max: 300 }], rooms: [1, 2] });
  assert.equal(matchesFilter(ad({ priceUsd: 200, rooms: 2 }), subscriber), true);
  assert.equal(matchesFilter(ad({ priceUsd: 200, rooms: 3 }), subscriber), false);
  assert.equal(matchesFilter(ad({ priceUsd: 400, rooms: 2 }), subscriber), false);
});
