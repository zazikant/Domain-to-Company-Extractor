import type {
  SearchResult,
  ScrapedContent,
  ClassificationResult,
  CompanyProfile,
  ConfidenceScore,
  CompanyRoleType,
} from "./types";
import {
  ROLE_KEYWORDS,
  REAL_ESTATE_KEYWORDS,
  INFRASTRUCTURE_KEYWORDS,
  INDUSTRIAL_KEYWORDS,
  COMPANY_NAME_JUNK_SUFFIXES,
  VALID_REAL_ESTATE,
  VALID_INFRASTRUCTURE,
  VALID_INDUSTRIAL,
  VALID_COMPANY_TYPES,
} from "./constants";

/**
 * Extract the effective domain from an email address.
 */
export function extractDomain(email: string): string {
  const parts = email.trim().toLowerCase().split("@");
  if (parts.length < 2 || !parts[1]) {
    throw new Error("Invalid email address");
  }

  let domain = parts[1].trim();

  const emailSubdomains = ["mail.", "email.", "smtp.", "imap.", "pop."];
  for (const sub of emailSubdomains) {
    if (domain.startsWith(sub)) {
      domain = domain.slice(sub.length);
      break;
    }
  }

  const multiPartTLDs = [
    "co.uk", "co.nz", "co.za", "co.au", "co.jp",
    "com.au", "com.br", "com.mx", "com.cn", "com.tw",
    "org.uk", "org.nz", "org.au", "gov.uk", "gov.au",
    "ac.uk", "edu.au",
  ];

  const domainParts = domain.split(".");
  for (const tld of multiPartTLDs) {
    const tldParts = tld.split(".");
    if (domainParts.length > tldParts.length) {
      const suffix = domainParts.slice(-tldParts.length).join(".");
      if (suffix === tld) {
        const mainPart = domainParts.slice(0, domainParts.length - tldParts.length);
        if (mainPart.length > 0) {
          return mainPart[mainPart.length - 1] + "." + suffix;
        }
      }
    }
  }

  return domain;
}

/**
 * Calculate confidence score from search results.
 */
export function calculateSearchConfidence(
  results: SearchResult[],
  domain: string
): ConfidenceScore {
  if (results.length === 0) {
    return { search: 0, scraping: 0, overall: 0 };
  }

  const domainName = domain.split(".")[0];
  let score = 0;

  const hasOfficialMatch = results.some((r) =>
    r.url.toLowerCase().includes(domain)
  );
  if (hasOfficialMatch) score += 0.4;

  const hasNameInTitle = results.some((r) => {
    const titleLower = r.title.toLowerCase();
    if (titleLower.includes(domainName.toLowerCase())) return true;
    for (let i = domainName.length - 1; i >= 4; i--) {
      const prefix = domainName.slice(0, i);
      if (titleLower.includes(prefix)) return true;
    }
    return false;
  });
  if (hasNameInTitle) score += 0.3;

  // keyword_match: 0.3 if any construction/industry keyword appears in snippets
  const combinedText = results
    .map((r) => `${r.title} ${r.snippet}`)
    .join(" ")
    .toLowerCase();

  const allKeywords = [
    ...Object.keys(ROLE_KEYWORDS),
    ...Object.keys(REAL_ESTATE_KEYWORDS),
    ...Object.keys(INFRASTRUCTURE_KEYWORDS),
    ...Object.keys(INDUSTRIAL_KEYWORDS),
  ];
  const hasKeywordMatch = allKeywords.some((keyword) =>
    combinedText.includes(keyword.toLowerCase())
  );
  if (hasKeywordMatch) score += 0.3;

  score = Math.min(score, 1.0);

  return {
    search: score,
    scraping: 0,
    overall: score,
  };
}

/**
 * Discover the REAL company domain from Serper search results.
 */
export function discoverRealDomain(
  searchResults: SearchResult[],
  originalDomain: string
): { domain: string; discovered: boolean } {
  if (searchResults.length === 0) {
    return { domain: originalDomain, discovered: false };
  }

  const skipDomains = new Set([
    "google.com", "google.co.in", "facebook.com", "linkedin.com",
    "twitter.com", "x.com", "instagram.com", "youtube.com",
    "wikipedia.org", "crunchbase.com", "justdial.com", "indiamart.com",
    "yellowpages.com", "yelp.com", "bloomberg.com", "reuters.com",
  ]);

  const domainCounts = new Map<string, number>();

  for (const result of searchResults) {
    try {
      const url = new URL(result.url);
      const host = url.hostname.replace(/^www\./, "");
      if (skipDomains.has(host)) continue;
      domainCounts.set(host, (domainCounts.get(host) || 0) + 1);
    } catch {
      // Invalid URL, skip
    }
  }

  let bestDomain = "";
  let bestCount = 0;
  const originalBase = originalDomain.split(".")[0].toLowerCase();

  for (const [domain, count] of domainCounts) {
    if (count > bestCount) {
      bestCount = count;
      bestDomain = domain;
    }
  }

  if (bestDomain && bestCount > 0) {
    const bestBase = bestDomain.split(".")[0].toLowerCase();
    const similarity = stringSimilarity(originalBase, bestBase);
    // Only redirect if the domain names are reasonably similar.
    // The old "bestCount >= 2" fallback was too aggressive — e.g. searching for
    // "plann3dsolutions" returned gemengserv.com twice (because it lists Plann3D as a client),
    // causing a wrong redirect. Require similarity >= 0.4 AND at least 2 occurrences,
    // OR similarity >= 0.6 (single occurrence is fine if names are close).
    if (similarity >= 0.6 || (similarity >= 0.4 && bestCount >= 3)) {
      const isDifferent = bestDomain !== originalDomain && !bestDomain.endsWith("." + originalDomain);
      return { domain: bestDomain, discovered: isDifferent };
    }
  }

  // Fallback: use the first search result's domain ONLY if it's similar enough
  const firstUrl = searchResults[0].url;
  if (firstUrl) {
    try {
      const url = new URL(firstUrl);
      const host = url.hostname.replace(/^www\./, "");
      if (!skipDomains.has(host)) {
        const firstBase = host.split(".")[0].toLowerCase();
        const firstSim = stringSimilarity(originalBase, firstBase);
        if (firstSim >= 0.4) {
          const isDifferent = host !== originalDomain && !host.endsWith("." + originalDomain);
          return { domain: host, discovered: isDifferent };
        }
      }
    } catch {
      // Invalid URL, use original
    }
  }

  return { domain: originalDomain, discovered: false };
}

function stringSimilarity(a: string, b: string): number {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1.0;
  const editDistance = levenshtein(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

const GENERIC_TRAILING_WORDS = [
  "company", "profile", "information", "details", "overview",
  "website", "official", "page", "site", "home", "welcome",
  "group", "enterprises", "solutions", "services", "industries",
  "corporation", "corporate", "international", "global",
  "india", "pvt", "private", "limited", "ltd", "inc",
  "free", "online", "portal", "dashboard",
];

/**
 * Extract company name from a title string.
 */
export function extractCompanyName(title: string): string {
  if (!title) return "Unknown";

  const delimiters = [" - ", " | ", " — ", " – ", " : "];
  let name = title;
  for (const delim of delimiters) {
    const idx = name.indexOf(delim);
    if (idx > 0) {
      name = name.slice(0, idx).trim();
      break;
    }
  }

  if (name === title) {
    const colonIdx = name.indexOf(':');
    if (colonIdx > 0) {
      name = name.slice(0, colonIdx).trim();
    }
  }

  for (const suffix of COMPANY_NAME_JUNK_SUFFIXES) {
    if (name.toLowerCase() === suffix.toLowerCase()) {
      return title.trim().split(/\s+/).slice(0, 3).join(" ");
    }
  }

  name = name.replace(/[\s\-|:]+$/, '').trim();

  const words = name.split(/\s+/);
  while (words.length > 1) {
    const lastWord = words[words.length - 1].toLowerCase().replace(/[.,;:]+$/, "");
    if (GENERIC_TRAILING_WORDS.includes(lastWord)) {
      words.pop();
    } else {
      break;
    }
  }
  name = words.join(" ");

  if (name.length < 2) {
    const titleWords = title.trim().split(/\s+/);
    return titleWords.slice(0, Math.min(3, titleWords.length)).join(" ");
  }

  return name;
}

/**
 * Clean scraped text by removing junk content.
 */
export function cleanScrapedText(rawText: string): string {
  if (!rawText || rawText.length < 20) return rawText;

  let lines = rawText
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length <= 2 && lines[0] && lines[0].length > 200) {
    const longLines = lines;
    lines = [];
    for (const longLine of longLines) {
      const sentences = longLine.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        const trimmed = s.trim();
        if (trimmed.length > 5) lines.push(trimmed);
      }
    }
  }

  const removePatterns = [
    /\b(Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Sector|Block|Plot|Floor|Suite|Unit|No\.)\b/i,
    /\b(Navi Mumbai|Mumbai|Delhi|Bangalore|Chennai|Hyderabad|Kolkata|Pune|India)\b.*\d{6}/i,
    /\d{6}\s*$/,
    /©|copyright|all rights reserved|privacy policy|terms of use|terms & conditions/i,
    /^(home|about|contact|services|products|blog|careers|login|sign in?|register|menu|search|skip to)\b.{0,50}$/i,
    /^.{1,10}$/,
    /^@[\w.]+$/,
  ];

  const keepPatterns = [
    /\b(company|group|corporation|industries|enterprises|solutions|services|products|manufacturing|development|construction|real estate|trading|engineering|consulting|technology|healthcare|finance|retail|energy|infrastructure|automotive|pharma|biotech|logistics)\b/i,
    /\b(established|founded|since|started|incorporated|headquartered|based in)\b/i,
    /\b(we (are|provide|offer|specialize|deal|manufacture|develop|deliver|serve))\b/i,
    /\b(our (mission|vision|products|services|team|clients|customers|portfolio))\b/i,
    /\b(leading|premier|top|one of the|renowned|established|prominent)\b/i,
    /\b(quality|excellence|innovation|sustainable|trusted|professional)\b/i,
    /\b(developer|contractor|consultant|consultancy|advisory|project management)\b/i,
    /\b(commercial|residential|industrial|infrastructure|highway|bridge|power|railway|airport|warehouse|hospitality|data center)\b/i,
    /\d{4}/,
  ];

  const cleanedLines: string[] = [];
  const seenLines = new Set<string>();

  for (const line of lines) {
    const lineLower = line.toLowerCase();
    if (seenLines.has(lineLower)) continue;
    seenLines.add(lineLower);

    let shouldRemove = false;
    for (const pattern of removePatterns) {
      if (pattern.test(line)) {
        shouldRemove = true;
        break;
      }
    }
    if (shouldRemove) continue;

    if (/^[\d\s\-+().,;:]+$/.test(line) && line.length < 30) continue;

    let hasUsefulContent = false;
    for (const pattern of keepPatterns) {
      if (pattern.test(line)) {
        hasUsefulContent = true;
        break;
      }
    }

    if (hasUsefulContent) {
      cleanedLines.push(line);
    } else if (line.length >= 30 && line.length <= 500) {
      cleanedLines.push(line);
    }
  }

  const deduped: string[] = [];
  for (const line of cleanedLines) {
    if (deduped.length > 0) {
      const prev = deduped[deduped.length - 1];
      if (stringSimilarity(prev.toLowerCase(), line.toLowerCase()) > 0.8) continue;
    }
    deduped.push(line);
  }

  return deduped.join(" ").slice(0, 3000);
}

/**
 * Detect company role type from text (heuristic fallback).
 */
export function detectCompanyRoleType(text: string): CompanyRoleType {
  const lower = text.toLowerCase();

  // Score each role type
  let bestRole: CompanyRoleType = "Can't Say";
  let bestCount = 0;

  for (const [keyword, role] of Object.entries(ROLE_KEYWORDS)) {
    const regex = new RegExp(keyword.toLowerCase(), "gi");
    const matches = lower.match(regex);
    const count = matches ? matches.length : 0;
    if (count > bestCount) {
      bestCount = count;
      bestRole = role;
    }
  }

  // If no construction-related keywords found at all, it's "Can't Say"
  if (bestCount === 0) return "Can't Say";

  return bestRole;
}

/**
 * Detect sector column values from text (heuristic fallback).
 * Returns comma-separated valid values or "Can't Say".
 */
function detectSectorColumn(
  text: string,
  keywords: Record<string, string>
): string {
  const lower = text.toLowerCase();
  const matchedValues = new Set<string>();

  for (const [keyword, value] of Object.entries(keywords)) {
    const regex = new RegExp(keyword.toLowerCase(), "gi");
    if (regex.test(lower)) {
      matchedValues.add(value);
    }
  }

  if (matchedValues.size === 0) return "Can't Say";
  return [...matchedValues].join(", ");
}

/**
 * Heuristic classification as a fallback when LLM is unavailable.
 */
export function heuristicClassify(content: ScrapedContent): ClassificationResult {
  const combinedText = [
    content.text,
    ...content.menuItems,
  ].join(" ").toLowerCase();

  const companyType = detectCompanyRoleType(combinedText);
  const realEstate = detectSectorColumn(combinedText, REAL_ESTATE_KEYWORDS);
  const infrastructure = detectSectorColumn(combinedText, INFRASTRUCTURE_KEYWORDS);
  const industrial = detectSectorColumn(combinedText, INDUSTRIAL_KEYWORDS);

  // If no construction role was detected, set all to "Can't Say"
  const isConstruction = companyType !== "Can't Say";

  return {
    companyType,
    realEstate: isConstruction ? realEstate : "Can't Say",
    infrastructure: isConstruction ? infrastructure : "Can't Say",
    industrial: isConstruction ? industrial : "Can't Say",
    classificationConfidence: 0.3,
    reasoning: "heuristic fallback - keyword matching applied to scraped content",
    summary: "",
    confirmedName: "",
    location: "",
    contactEmail: "",
    contactPhone: "",
  };
}

/**
 * Build final company profile from classification + search results.
 */
export function buildFinalProfile(
  searchResults: SearchResult[],
  classification: ClassificationResult,
  searchConfidence: number
): { profile: CompanyProfile; confidence: ConfidenceScore } {
  const llmConfidence = classification.classificationConfidence;

  const name = searchResults.length > 0
    ? extractCompanyName(searchResults[0].title)
    : "Unknown";

  const confirmedName = (classification.confirmedName && classification.confirmedName.length > 2)
    ? classification.confirmedName
    : name;

  let companyType = classification.companyType;
  let realEstate = classification.realEstate;
  let infrastructure = classification.infrastructure;
  let industrial = classification.industrial;

  // If LLM was very unsure, fall back to heuristic
  if (llmConfidence < 0.2 && searchResults.length > 0) {
    const searchText = searchResults.map((r) => `${r.title} ${r.snippet}`).join(" ");
    const heuristicRole = detectCompanyRoleType(searchText);
    const isConstruction = heuristicRole !== "Can't Say";

    if (companyType === "Can't Say") companyType = heuristicRole;
    if (realEstate === "Can't Say" && isConstruction) {
      realEstate = detectSectorColumn(searchText, REAL_ESTATE_KEYWORDS);
    }
    if (infrastructure === "Can't Say" && isConstruction) {
      infrastructure = detectSectorColumn(searchText, INFRASTRUCTURE_KEYWORDS);
    }
    if (industrial === "Can't Say" && isConstruction) {
      industrial = detectSectorColumn(searchText, INDUSTRIAL_KEYWORDS);
    }
  }

  const description = classification.summary || "";

  const overallConfidence = searchConfidence > 0
    ? (searchConfidence + llmConfidence) / 2
    : llmConfidence;

  const partial = llmConfidence < 0.7;

  const profile: CompanyProfile = {
    name,
    confirmedName,
    companyType,
    realEstate,
    infrastructure,
    industrial,
    description,
    location: classification.location || "",
    contactEmail: classification.contactEmail || "",
    contactPhone: classification.contactPhone || "",
    cachedAt: Date.now(),
    confidenceOverall: Math.min(Math.round(overallConfidence * 100) / 100, 1.0),
    partial,
  };

  return {
    profile,
    confidence: {
      search: searchConfidence,
      scraping: llmConfidence,
      overall: Math.min(Math.round(overallConfidence * 100) / 100, 1.0),
    },
  };
}

/**
 * Validate company role type.
 */
export function isValidCompanyRoleType(value: string): value is CompanyRoleType {
  return (VALID_COMPANY_TYPES as string[]).includes(value);
}

/**
 * Validate a sector column value.
 * Accepts comma-separated valid values (e.g. "Power, Highway") or "Can't Say".
 * Returns the validated string.
 */
export function validateSectorColumn(raw: unknown, validValues: readonly string[]): string {
  if (typeof raw !== "string" || !raw.trim()) return "Can't Say";

  const trimmed = raw.trim();

  // If "Can't Say" (or similar), return as-is
  if (/^can'?t say$/i.test(trimmed)) return "Can't Say";

  // Split by comma and validate each value
  const parts = trimmed
    .split(/,\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const validSet = new Set(validValues.map((v) => v.toLowerCase()));
  const validated: string[] = [];

  for (const part of parts) {
    if (/^can'?t say$/i.test(part)) return "Can't Say"; // If any part is "Can't Say", whole thing is

    // Exact match (case-insensitive)
    if (validSet.has(part.toLowerCase())) {
      // Find the properly-cased version
      const match = validValues.find((v) => v.toLowerCase() === part.toLowerCase());
      if (match) validated.push(match);
      continue;
    }

    // Fuzzy match — check if any valid value is contained in the part or vice versa
    let fuzzyMatched = false;
    for (const valid of validValues) {
      if (part.toLowerCase().includes(valid.toLowerCase()) || valid.toLowerCase().includes(part.toLowerCase())) {
        if (!validated.includes(valid)) validated.push(valid);
        fuzzyMatched = true;
        break;
      }
    }

    // If no match found, skip this value
    if (!fuzzyMatched) {
      console.log(`[Validation] Unknown sector value: "${part}" — skipped`);
    }
  }

  return validated.length > 0 ? validated.join(", ") : "Can't Say";
}
