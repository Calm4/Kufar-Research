import type { DebugInfo } from "./kufar";

export function formatDebugReport(debug: DebugInfo): string {
  const lines: string[] = [];
  lines.push("Kufar monitor — debug (без записи в KV и без Telegram)");
  lines.push(`__NEXT_DATA__ найден: ${debug.hasNextData ? "да" : "нет"}`);
  if (debug.hasNextData) {
    lines.push(`Размер __NEXT_DATA__: ${debug.nextDataLength} байт`);
  }
  lines.push(`Первый найденный id объявления: ${debug.firstAdId ?? "не найден"}`);
  lines.push("");
  lines.push("Кусок __NEXT_DATA__ вокруг этого id (±300/3500 символов):");
  lines.push(debug.adJsonSnippet ?? "(не найдено — id не встречается в __NEXT_DATA__ как есть)");
  return lines.join("\n");
}
