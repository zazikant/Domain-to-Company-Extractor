// ── Construction / Civil Engineering Company Taxonomy ──

/** Role the company plays in the construction/civil engineering ecosystem. */
export type CompanyRoleType = "Developer" | "Contractor" | "Consultant" | "Can't Say";

/** Individual valid values per sector column. */
export const REAL_ESTATE_VALUES = ["Commercial", "Residential", "Data Center", "Educational", "Hospitality"] as const;
export const INFRASTRUCTURE_VALUES = ["Airport", "Bridges", "Hydro", "Highway", "Marine", "Power", "Railways"] as const;
export const INDUSTRIAL_VALUES = ["Aerospace", "Warehouse"] as const;

/** A sector column stores comma-separated valid values (e.g. "Power, Highway") or "Can't Say". */
export type SectorColumn = string; // validated at runtime

export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
}

export interface ScrapedContent {
  html: string;
  text: string;
  menuItems: string[];
  rawContacts: string; // pre-extracted phone/email from header/footer before they are stripped
}

export interface ClassificationResult {
  companyType: CompanyRoleType;
  realEstate: SectorColumn;      // e.g. "Commercial" or "Commercial, Residential" or "Can't Say"
  infrastructure: SectorColumn;   // e.g. "Power, Highway" or "Can't Say"
  industrial: SectorColumn;       // e.g. "Warehouse" or "Can't Say"
  classificationConfidence: number;
  reasoning: string;
  summary: string;
  confirmedName: string; // GLM-confirmed official company name from evidence
  location: string;    // office/city/location extracted from website
  contactEmail: string; // contact email found on website
  contactPhone: string; // contact phone found on website
}

export interface CompanyProfile {
  name: string;
  confirmedName: string; // GLM-confirmed official name (primary display)
  companyType: CompanyRoleType;
  realEstate: SectorColumn;
  infrastructure: SectorColumn;
  industrial: SectorColumn;
  description: string;
  location: string;
  contactEmail: string;
  contactPhone: string;
  cachedAt: number;
  confidenceOverall: number;
  partial: boolean;
}

export interface ConfidenceScore {
  search: number;
  scraping: number;
  overall: number;
}
