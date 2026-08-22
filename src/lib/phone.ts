/**
 * Phone numbers always read as 0524-8959-25, whatever was typed.
 *
 * Separators in the input are thrown away and regrouped, so every one of these
 * gives the same result:
 *
 *   0524895925      0524-895925      0524-895-925      0524-8959-25
 *
 * The grouping is fixed rather than derived from the number's length: four
 * digits, then whatever is in the middle, then the last two.
 */
export function formatPhone(input: string | null | undefined): string {
  const digits = (input ?? "").replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  // Too short to give the middle group anything — keep it as one break so
  // typing the first few digits does not jump around.
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, -2)}-${digits.slice(-2)}`;
}
