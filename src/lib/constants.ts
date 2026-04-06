import type { CompanyRoleType } from "./types";
import { REAL_ESTATE_VALUES, INFRASTRUCTURE_VALUES, INDUSTRIAL_VALUES } from "./types";

// ─── Pipeline ───────────────────────────────────────────────
export const PARTIAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const FULL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Timeouts (ms) ──────────────────────────────────────────
export const TIMEOUT_UPSTASH_REDIS_MS = 50;
export const TIMEOUT_SERPER_SEARCH_MS = 3_000;
export const TIMEOUT_BROWSERLESS_TOTAL_MS = 15_000;
export const TIMEOUT_GLM_CLASSIFY_MS = 60_000;
export const TIMEOUT_CONVEX_READ_MS = 5_000;
export const TIMEOUT_CONVEX_WRITE_MS = 5_000;

// ─── Company Role keywords (for heuristic fallback) ─────────
export const ROLE_KEYWORDS: Record<string, CompanyRoleType> = {
  // Developer signals
  "real estate developer": "Developer",
  "property developer": "Developer",
  "project developer": "Developer",
  "land development": "Developer",
  "township developer": "Developer",
  "housing developer": "Developer",
  "builds real estate": "Developer",
  "develops projects": "Developer",

  // Contractor signals
  "civil contractor": "Contractor",
  "building contractor": "Contractor",
  "construction contractor": "Contractor",
  "general contractor": "Contractor",
  "electrical contractor": "Contractor",
  "mechanical contractor": "Contractor",
  "contracting": "Contractor",
  "execution of construction": "Contractor",
  "construction work": "Contractor",
  "builds on behalf": "Contractor",
  "epc contractor": "Contractor",
  "turnkey contractor": "Contractor",

  // Consultant signals
  "consulting": "Consultant",
  "consultancy": "Consultant",
  "consultant": "Consultant",
  "advisory": "Consultant",
  "engineering consultancy": "Consultant",
  "design consultancy": "Consultant",
  "project management consultant": "Consultant",
  "structural engineer": "Consultant",
  "architecture consultancy": "Consultant",
  "design and build": "Consultant",
  "feasibility study": "Consultant",
  "project management services": "Consultant",
};

// ─── Real Estate sub-sector keywords ────────────────────────
export const REAL_ESTATE_KEYWORDS: Record<string, string> = {
  "commercial": "Commercial",
  "office space": "Commercial",
  "office building": "Commercial",
  "it park": "Commercial",
  "business park": "Commercial",
  "shopping centre": "Commercial",
  "shopping mall": "Commercial",
  "retail space": "Commercial",
  "residential": "Residential",
  "housing": "Residential",
  "apartment": "Residential",
  "villa": "Residential",
  "township": "Residential",
  "flat": "Residential",
  "gated community": "Residential",
  "data center": "Data Center",
  "data centre": "Data Center",
  "datacentre": "Data Center",
  "colocation": "Data Center",
  "educational": "Educational",
  "school": "Educational",
  "university": "Educational",
  "campus": "Educational",
  "institutional": "Educational",
  "hospitality": "Hospitality",
  "hotel": "Hospitality",
  "resort": "Hospitality",
  "serviced apartment": "Hospitality",
};

// ─── Infrastructure sub-sector keywords ─────────────────────
export const INFRASTRUCTURE_KEYWORDS: Record<string, string> = {
  "airport": "Airport",
  "airfield": "Airport",
  "aerodrome": "Airport",
  "bridges": "Bridges",
  "bridge": "Bridges",
  "flyover": "Bridges",
  "viaduct": "Bridges",
  "hydro": "Hydro",
  "hydropower": "Hydro",
  "dam": "Hydro",
  "hydroelectric": "Hydro",
  "highway": "Highway",
  "expressway": "Highway",
  "road": "Highway",
  "tunnel": "Highway",
  "marine": "Marine",
  "port": "Marine",
  "harbour": "Marine",
  "dock": "Marine",
  "jetty": "Marine",
  "seawall": "Marine",
  "power": "Power",
  "power plant": "Power",
  "thermal power": "Power",
  "solar power": "Power",
  "substation": "Power",
  "transmission": "Power",
  "railway": "Railways",
  "rail": "Railways",
  "metro": "Railways",
  "monorail": "Railways",
  "railyway": "Railways",
};

// ─── Industrial sub-sector keywords ─────────────────────────
export const INDUSTRIAL_KEYWORDS: Record<string, string> = {
  "aerospace": "Aerospace",
  "aircraft": "Aerospace",
  "aviation facility": "Aerospace",
  "warehouse": "Warehouse",
  "warehousing": "Warehouse",
  "logistics hub": "Warehouse",
  "cold storage": "Warehouse",
  "distribution center": "Warehouse",
  "distribution centre": "Warehouse",
};

// ─── Junk suffixes to strip from company names ──────────────
export const COMPANY_NAME_JUNK_SUFFIXES: string[] = [
  "Home", "Welcome", "Official Website", "Official Site",
  "Homepage", "Main Page", "Login", "Sign In",
];

// ─── Valid enum values ─────────────────────────────────────
export const VALID_COMPANY_TYPES: CompanyRoleType[] = [
  "Developer",
  "Contractor",
  "Consultant",
  "Can't Say",
];

export const VALID_REAL_ESTATE = [...REAL_ESTATE_VALUES, "Can't Say"];
export const VALID_INFRASTRUCTURE = [...INFRASTRUCTURE_VALUES, "Can't Say"];
export const VALID_INDUSTRIAL = [...INDUSTRIAL_VALUES, "Can't Say"];
