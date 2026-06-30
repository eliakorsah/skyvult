// Single source of truth for the company/legal facts shown on the public
// Terms and Privacy pages. Replace the [TODO] placeholders with your real
// registered entity details before going live — these strings appear
// publicly on /terms and /privacy.
export const LEGAL = {
  appName: "SkyVult",
  // Operating / trading name. Not yet a registered company — once you
  // incorporate, change this to the registered legal name and fill in
  // `registration` + `address` below (both are hidden while blank).
  companyName: "SkyVult",
  // Company registration number. Leave "" until registered — it stays hidden.
  registration: "",
  // Registered business address. Leave "" until registered — stays hidden.
  address: "",
  // Where users reach support / send legal & privacy requests.
  contactEmail: "support@skyvult.com",
  // Governing law / jurisdiction.
  jurisdiction: "the Republic of Ghana",
  // Last time these documents were reviewed/updated.
  lastUpdated: "30 June 2026",
  // Minimum age to use the platform.
  minAge: 18,
} as const;
