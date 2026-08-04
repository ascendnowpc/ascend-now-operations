// Phone numbers are stored as one string — "+91 90000 00000" — but edited as
// a dial-code selector plus a number field (see PhoneInput). These two
// helpers are the split/join between those two shapes.

export interface PhoneParts {
  dialCode: string;
  number: string;
}

const DIAL_CODE_RE = /^(\+\d{1,4})\s*(.*)$/;

/**
 * Splits a stored phone number into its dial code and the rest. A value that
 * doesn't start with a dial code (legacy rows, or a number typed without one)
 * is returned whole as the number, with `fallbackDialCode` for the selector.
 */
export function splitPhoneNumber(stored: string | null | undefined, fallbackDialCode = "+1"): PhoneParts {
  const value = (stored ?? "").trim();
  const match = value.match(DIAL_CODE_RE);
  if (match) return { dialCode: match[1], number: match[2] };
  return { dialCode: fallbackDialCode, number: value };
}

/**
 * Joins the two fields back into the stored form. An empty number means "no
 * phone number" — null, not a bare dial code, so a blank field never gets
 * saved as "+1".
 */
export function joinPhoneNumber(dialCode: string, number: string): string | null {
  const trimmed = number.trim();
  if (!trimmed) return null;
  return `${dialCode.trim()} ${trimmed}`;
}
