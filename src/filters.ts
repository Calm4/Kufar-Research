import type { AdDetails } from "./hotness";
import type { Subscriber } from "./subscribers";

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
    !subscriber.rooms.includes(ad.rooms)
  ) {
    return false;
  }
  return true;
}
