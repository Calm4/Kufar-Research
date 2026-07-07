import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFiltersKeyboard,
  describeFilters,
  findPriceBucketByKey,
  roomLabel,
} from "./filter-ui";
import type { Subscriber } from "./subscribers";

function sub(overrides: Partial<Subscriber> = {}): Subscriber {
  return { chatId: "1", ...overrides };
}

test("describeFilters: no filters set", () => {
  assert.equal(describeFilters(sub()), "Фильтров нет — приходят все объявления.");
});

test("describeFilters: price and rooms both set", () => {
  const text = describeFilters(sub({ minPrice: 100, maxPrice: 300, rooms: [1, 4] }));
  assert.match(text, /100–300/);
  assert.match(text, /1, 4\+/);
});

test("roomLabel: 4 renders as '4+', others as-is", () => {
  assert.equal(roomLabel(4), "4+");
  assert.equal(roomLabel(2), "2");
});

test("findPriceBucketByKey: known and unknown keys", () => {
  assert.equal(findPriceBucketByKey("200-400")?.min, 200);
  assert.equal(findPriceBucketByKey("nonexistent"), undefined);
});

test("buildFiltersKeyboard: marks selected room bucket with a checkmark", () => {
  const kb = buildFiltersKeyboard(sub({ rooms: [2] }));
  const roomsRow = kb.inline_keyboard[0];
  const twoRoomButton = roomsRow.find((b) => b.callback_data === "room:2");
  const threeRoomButton = roomsRow.find((b) => b.callback_data === "room:3");
  assert.match(twoRoomButton!.text, /^✅/);
  assert.doesNotMatch(threeRoomButton!.text, /^✅/);
});

test("buildFiltersKeyboard: marks matching price bucket, and 'any' when no filter set", () => {
  const noFilter = buildFiltersKeyboard(sub());
  const anyButton = noFilter.inline_keyboard.flat().find((b) => b.callback_data === "price:any");
  assert.match(anyButton!.text, /^✅/);

  const withFilter = buildFiltersKeyboard(sub({ minPrice: 200, maxPrice: 400 }));
  const matchingButton = withFilter.inline_keyboard.flat().find((b) => b.callback_data === "price:200-400");
  assert.match(matchingButton!.text, /^✅/);
});

test("buildFiltersKeyboard: custom price range outside any preset selects nothing", () => {
  const kb = buildFiltersKeyboard(sub({ minPrice: 150, maxPrice: 350 }));
  const anySelected = kb.inline_keyboard.flat().some((b) => b.text.startsWith("✅"));
  assert.equal(anySelected, false);
});

test("buildFiltersKeyboard: always includes a reset button", () => {
  const kb = buildFiltersKeyboard(sub());
  const flat = kb.inline_keyboard.flat();
  assert.ok(flat.some((b) => b.callback_data === "reset"));
});
