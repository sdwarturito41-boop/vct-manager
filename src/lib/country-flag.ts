/**
 * Convert a 2-letter ISO country code to a flag emoji.
 * Works by converting each letter to its regional indicator symbol.
 */
export function countryToFlag(countryCode: string): string {
  if (!countryCode || countryCode.length !== 2) return "🏳️";
  const code = countryCode.toUpperCase();
  const offset = 127397;
  return String.fromCodePoint(
    code.charCodeAt(0) + offset,
    code.charCodeAt(1) + offset
  );
}
