export const COUNTRY_CODES: { code: string; name: string }[] = [
  { code: "+971", name: "UAE" },
  { code: "+966", name: "Saudi Arabia" },
  { code: "+965", name: "Kuwait" },
  { code: "+974", name: "Qatar" },
  { code: "+973", name: "Bahrain" },
  { code: "+968", name: "Oman" },
  { code: "+962", name: "Jordan" },
  { code: "+961", name: "Lebanon" },
  { code: "+20",  name: "Egypt" },
  { code: "+92",  name: "Pakistan" },
  { code: "+91",  name: "India" },
  { code: "+94",  name: "Sri Lanka" },
  { code: "+880", name: "Bangladesh" },
  { code: "+44",  name: "UK" },
  { code: "+1",   name: "USA / Canada" },
  { code: "+61",  name: "Australia" },
  { code: "+64",  name: "New Zealand" },
  { code: "+49",  name: "Germany" },
  { code: "+33",  name: "France" },
  { code: "+39",  name: "Italy" },
  { code: "+34",  name: "Spain" },
  { code: "+31",  name: "Netherlands" },
  { code: "+41",  name: "Switzerland" },
  { code: "+46",  name: "Sweden" },
  { code: "+47",  name: "Norway" },
  { code: "+45",  name: "Denmark" },
  { code: "+7",   name: "Russia" },
  { code: "+90",  name: "Turkey" },
  { code: "+82",  name: "South Korea" },
  { code: "+81",  name: "Japan" },
  { code: "+86",  name: "China" },
  { code: "+65",  name: "Singapore" },
  { code: "+60",  name: "Malaysia" },
  { code: "+63",  name: "Philippines" },
  { code: "+66",  name: "Thailand" },
  { code: "+62",  name: "Indonesia" },
  { code: "+27",  name: "South Africa" },
  { code: "+234", name: "Nigeria" },
  { code: "+254", name: "Kenya" },
  { code: "+212", name: "Morocco" },
];

export function splitPhone(fullPhone: string | null): { code: string; number: string } {
  if (!fullPhone) return { code: "+971", number: "" };
  const match = fullPhone.match(/^(\+\d+)\s(.*)$/);
  if (match) return { code: match[1], number: match[2] };
  // No recognised prefix — show raw in number field
  return { code: "+971", number: fullPhone };
}

export function joinPhone(code: string, number: string): string | null {
  const n = number.trim();
  return n ? `${code} ${n}` : null;
}
