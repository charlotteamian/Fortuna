/**
 * CapacitorHttp parses application/json responses on Android/iOS even when
 * responseType is "text". Quote parsers consume text on every platform, so
 * preserve strings and serialize native JSON values back to valid JSON text.
 */
export function httpResponseDataToText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (data == null) return '';
  return JSON.stringify(data) ?? String(data);
}
