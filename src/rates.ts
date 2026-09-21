const NBRB_USD_URL = "https://api.nbrb.by/exrates/rates/USD?parammode=2";

interface NbrbRateResponse {
  Cur_Scale?: unknown;
  Cur_OfficialRate?: unknown;
}

export async function fetchBynPerUsd(): Promise<number | null> {
  try {
    const response = await fetch(NBRB_USD_URL, {
      headers: { Accept: "application/json" },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as NbrbRateResponse;
    const scale = Number(data.Cur_Scale);
    const rate = Number(data.Cur_OfficialRate);
    return Number.isFinite(scale) && scale > 0 && Number.isFinite(rate) && rate > 0
      ? rate / scale
      : null;
  } catch {
    return null;
  }
}
