import type { AdDetails } from "./hotness";
import type { Subscriber } from "./subscribers";

// Room counts of 4 and above collapse into a single "4+" bucket, both in the
// filter buttons (1/2/3/4+) and here — so a subscriber who picked "4+" (or
// typed /rooms 4) also gets 5-room, 6-room, etc. listings instead of only
// exactly-4-room ones.
export function roomBucket(rooms: number): number {
  return rooms >= 4 ? 4 : rooms;
}

// An ad passes a subscriber's filter unless it actively violates a bound the
// subscriber set. Ads missing price/room data (Kufar didn't render it) always
// pass — better a false positive than silently dropping a listing because
// the site withheld a field.
export function matchesFilter(ad: AdDetails, subscriber: Subscriber): boolean {
  if (subscriber.minPrice != null && ad.priceUsd != null && ad.priceUsd < subscriber.minPrice) {
    return false;
  }
  if (subscriber.maxPrice != null && ad.priceUsd != null && ad.priceUsd > subscriber.maxPrice) {
    return false;
  }
  if (
    subscriber.rooms != null &&
    subscriber.rooms.length > 0 &&
    ad.rooms != null &&
    !subscriber.rooms.includes(roomBucket(ad.rooms))
  ) {
    return false;
  }
  return true;
}
