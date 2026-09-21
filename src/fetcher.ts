const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const ACCEPT_LANGUAGE = "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7";

export interface FetchResult {
  status: number;
  html: string;
}

const MAX_HTML_BYTES = 5 * 1024 * 1024;

async function readTextLimited(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_HTML_BYTES) {
    throw new Error(`Response is too large: ${declaredLength} bytes`);
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error(`Response exceeded ${MAX_HTML_BYTES} bytes`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export async function fetchSearchHtml(searchUrl: string): Promise<FetchResult> {
  const res = await fetch(searchUrl, {
    headers: {
      "User-Agent": USER_AGENT,
      "Accept-Language": ACCEPT_LANGUAGE,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    },
    // Kufar is itself behind Cloudflare — without this, polls could be
    // served a cached copy of the search page instead of the freshest one,
    // adding extra delay on top of the polling interval. `cf` is a
    // Cloudflare Workers-specific fetch() extension (see @cloudflare/workers-types).
    cf: { cacheTtl: 0, cacheEverything: false },
  });
  const html = await readTextLimited(res);
  return { status: res.status, html };
}
