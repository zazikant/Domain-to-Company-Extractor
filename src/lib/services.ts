import type { SearchResult, ScrapedContent, ClassificationResult, CompanyRoleType, SectorColumn } from "./types";
import {
  VALID_COMPANY_TYPES,
  VALID_REAL_ESTATE,
  VALID_INFRASTRUCTURE,
  VALID_INDUSTRIAL,
  REAL_ESTATE_VALUES,
  INFRASTRUCTURE_VALUES,
  INDUSTRIAL_VALUES,
  TIMEOUT_SERPER_SEARCH_MS,
  TIMEOUT_BROWSERLESS_TOTAL_MS,
  TIMEOUT_GLM_CLASSIFY_MS,
} from "./constants";
import { heuristicClassify, cleanScrapedText, validateSectorColumn, isValidCompanyRoleType } from "./pipeline";

/**
 * Serper search result with knowledgeGraph support.
 */
export interface SerperResponse {
  organic: Array<{ link?: string; title?: string; snippet?: string }>;
  knowledgeGraph?: {
    title?: string;
    type?: string;
    description?: string;
    website?: string;
    subtitle?: string;
    source?: { name?: string; url?: string };
  };
}

    /**
 * Search for a domain using Serper.dev API.
 * THREE-QUERY STRATEGY for maximum research depth.
 */
export async function serperSearch(
  domain: string,
  apiKey: string
): Promise<SearchResult[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_SERPER_SEARCH_MS);

    const domainBase = domain.split(".")[0];
    const broadQuery = `"${domainBase}" company`;
    const siteQuery = `site:${domain}`;
    const aboutQuery = `"${domainBase}" about services products`;

    const [broadRes, siteRes, aboutRes] = await Promise.allSettled([
      fetch(
        `https://google.serper.dev/search?q=${encodeURIComponent(broadQuery)}`,
        {
          method: "GET",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          signal: controller.signal,
        }
      ),
      fetch(
        `https://google.serper.dev/search?q=${encodeURIComponent(siteQuery)}`,
        {
          method: "GET",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          signal: controller.signal,
        }
      ),
      fetch(
        `https://google.serper.dev/search?q=${encodeURIComponent(aboutQuery)}`,
        {
          method: "GET",
          headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
          signal: controller.signal,
        }
      ),
    ]);

    clearTimeout(timeout);

    for (const res of [broadRes, siteRes, aboutRes]) {
      if (res.status === "fulfilled" && res.value.status === 401) {
        throw new Error("SERPER_AUTH_FAILED");
      }
    }

    const parseResponse = async (res: PromiseSettledResult<Response>): Promise<{ results: SearchResult[]; knowledgeGraph?: SerperResponse["knowledgeGraph"] }> => {
      if (res.status === "rejected") return { results: [] };
      const response = res.value;
      if (response.status === 429) return { results: [] };
      if (!response.ok) return { results: [] };

      const data: SerperResponse = await response.json();
      const organic = data.organic || [];
      return {
        results: organic.slice(0, 5).map(
          (item: { link?: string; title?: string; snippet?: string }) => ({
            url: item.link || "",
            title: item.title || "",
            snippet: item.snippet || "",
          })
        ),
        knowledgeGraph: data.knowledgeGraph,
      };
    };

    const broad = await parseResponse(broadRes);
    const site = await parseResponse(siteRes);
    const about = await parseResponse(aboutRes);

    const seenUrls = new Set<string>();
    const merged: SearchResult[] = [];

    for (const r of [...broad.results, ...about.results, ...site.results]) {
      if (r.url && !seenUrls.has(r.url)) {
        seenUrls.add(r.url);
        merged.push(r);
      }
      if (merged.length >= 10) break;
    }

    if (broad.knowledgeGraph && merged.length > 0) {
      const kg = broad.knowledgeGraph;
      if (kg.title && !merged[0].title) {
        merged[0].title = kg.title;
      }
      if (kg.description) {
        const hasKgDesc = merged.some(r => r.snippet === kg.description);
        if (!hasKgDesc && kg.description.length > 30) {
          merged.unshift({
            url: kg.website || merged[0].url,
            title: kg.title || merged[0].title,
            snippet: kg.description,
          });
        }
      }
      if (kg.website) {
        merged[0].url = kg.website;
      }
      if (kg.type) {
        merged[0].snippet = `[${kg.type}] ${merged[0].snippet}`;
      }
    }

    console.log(`[Serper] Broad: ${broad.results.length}, About: ${about.results.length}, Site: ${site.results.length}, Merged: ${merged.length}, KG: ${broad.knowledgeGraph ? 'yes' : 'no'}`);

    return merged;
  } catch (error: unknown) {
    if (error instanceof Error && error.message === "SERPER_AUTH_FAILED") {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      console.warn("[Serper] Request timed out, returning empty results");
      return [];
    }
    console.warn("[Serper] Request failed, returning empty results:", error);
    return [];
  }
}

/**
 * Scrape a website using Browserless.io.
 */
export async function scrapeWithBrowserless(
  domain: string,
  token: string
): Promise<ScrapedContent> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_BROWSERLESS_TOTAL_MS);

    const response = await fetch(
      `https://chrome.browserless.io/content?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: `https://${domain}`,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (response.status === 429) {
      throw new Error("BROWSERLESS_RATE_LIMITED");
    }

    if (!response.ok) {
      throw new Error(`BROWSERLESS_ERROR_${response.status}`);
    }

    const html: string = await response.text();

    // Pre-extract contacts from header/footer BEFORE stripping them
    const headerFooterHtml = (html.match(/<header[\s\S]*?<\/header>/gi) || [])
      .concat(html.match(/<footer[\s\S]*?<\/footer>/gi) || [])
      .join(" ");
    const headerFooterText = headerFooterHtml
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const phoneMatches = headerFooterText.match(/\+?\d[\d\s\-\(\)]{7,20}/g) || [];
    const emailMatches = headerFooterText.match(/[\w.\-]+@[\w.\-]+\.\w{2,}/g) || [];
    const fullText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const allPhones = [...new Set([
      ...(fullText.match(/\+?\d[\d\s\-\(\)]{7,20}/g) || []),
      ...phoneMatches,
    ].map(p => p.trim()).filter(p => p.replace(/[\s\-\(\)]/g, "").length >= 8))];
    const allEmails = [...new Set([
      ...(fullText.match(/[\w.\-]+@[\w.\-]+\.\w{2,}/g) || []),
      ...emailMatches,
    ].map(e => e.trim()))];

    const contactParts: string[] = [];
    if (allEmails.length > 0) contactParts.push(`Emails found: ${allEmails.join(", ")}`);
    if (allPhones.length > 0) contactParts.push(`Phone numbers found: ${allPhones.join(", ")}`);
    const rawContacts = contactParts.join(" | ");

    const rawText = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const cleanedText = cleanScrapedText(rawText);

    const menuItems: string[] = [];
    const navRegex = /<nav[\s\S]*?<\/nav>/gi;
    const navMatches = html.match(navRegex) || [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;

    for (const nav of navMatches) {
      let liMatch;
      const liMatches: string[] = [];
      while ((liMatch = liRegex.exec(nav)) !== null) {
        const liContent = liMatch[1]
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (liContent && liContent.length > 3 && liContent.length < 80) {
          liMatches.push(liContent);
        }
      }
      menuItems.push(...liMatches.slice(0, 20));
    }

    console.log(`[Browserless] Scraped ${domain}: raw=${rawText.length}chars, cleaned=${cleanedText.length}chars, menu=${menuItems.length}items, contacts=${rawContacts.length}chars`);

    return {
      html,
      text: cleanedText,
      menuItems: [...new Set(menuItems)].slice(0, 50),
      rawContacts,
    };
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("BROWSERLESS_TIMEOUT");
    }
    throw error;
  }
}

// ── Shared LLM prompt builder for the new construction taxonomy ──

function buildSystemPrompt(): string {
  return `You are a senior construction/civil engineering industry analyst. Your task is to research a company using the provided data and produce an accurate classification for the construction industry.

## DATA SOURCES PROVIDED
1. **Google Search Results** — titles, URLs, and snippets from a web search about this company.
2. **Website Content** — actual text scraped from the company's website (cleaned of navigation, addresses, phone numbers, etc.).
3. **Navigation Menu** — the website's menu structure reveals what services/products the company offers.

## YOUR TASK — CONSTRUCTION INDUSTRY CLASSIFICATION

### 1. CONFIRMED COMPANY NAME (critical)
Determine the OFFICIAL, STANDARDIZED company name by cross-referencing ALL sources:
- Check website content for self-referencing (e.g., "Welcome to Gajra Group")
- Check search result titles and snippets
- Include legal suffixes (Pvt Ltd, Ltd, Inc, LLC) if found
- DO NOT include descriptive words like "Company Profile", "Home", "Official Website"

### 2. COMPANY TYPE — exactly one of these 4 values:
- **Developer** — Company that DEVELOPS or BUILDS real estate or infrastructure projects (e.g., a real estate developer, project developer, land developer)
- **Contractor** — Company that EXECUTES construction work, BUILDS on behalf of others (e.g., a civil contractor, building contractor, EPC contractor, general contractor)
- **Consultant** — Engineering/design consulting or advisory services (e.g., structural engineers, project management consultants, architecture consultancy, design advisory)
- **Can't Say** — Businesses that don't fit the construction/civil world at all (e.g., a software company, retail brand, bank, hospital chain)

A company that BOTH develops AND constructs its own projects should be classified as **Developer**.
A company that only builds for others should be classified as **Contractor**.

### 3. SECTOR CLASSIFICATION — 3 separate columns:
Each column contains comma-separated sub-sectors the company operates in, or "Can't Say" if there's no match.

**Real Estate column** (pick from: Commercial, Residential, Data Center, Educational, Hospitality):
- Does the company build/develop/consult on commercial offices, residential apartments, data centers, schools/universities, or hotels?

**Infrastructure column** (pick from: Airport, Bridges, Hydro, Highway, Marine, Power, Railways):
- Does the company work on airports, bridges/dams, hydropower, highways/roads, ports/marine, power plants, or railways/metro?

**Industrial column** (pick from: Aerospace, Warehouse):
- Does the company work on aerospace facilities or warehouses/logistics hubs?

Each column can have MULTIPLE values (comma-separated). If no match, return "Can't Say".

**IMPORTANT — SECTOR DETECTION RULES:**
- Scan ALL data sources (search snippets, website content, navigation menu) for ANY mention of each sector.
- Even if the company's own website emphasizes one sector, DO include other sectors if search results, news articles, or third-party sources mention them.
- Look for keywords like: residential, apartments, housing, township, villas, flats, mixed-use (→ Residential), offices, commercial (→ Commercial), etc.
- A single mention in any source is sufficient to include that sector.
- "Mixed-use" projects typically include BOTH Commercial and Residential.

### 4. SUMMARY (1 paragraph, 2-4 sentences)
Professional paragraph about the company's core business in the construction/civil engineering context. DO NOT include addresses, phone numbers, or contact info.

### 5. LOCATION (city/country), 6. CONTACT INFO
Extract from data if available. Return empty string if not found.

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no code fences):
{"confirmedName": "...", "companyType": "Developer|Contractor|Consultant|Can't Say", "realEstate": "Commercial, Residential or Can't Say", "infrastructure": "Power, Highway or Can't Say", "industrial": "Warehouse or Can't Say", "confidence": 0.0-1.0, "reasoning": "1-2 sentences", "summary": "...", "location": "City, Country", "contactEmail": "email@company.com or empty", "contactPhone": "+XX XXXXXXXXXX or empty"}

## EXAMPLES

Example 1 — A large Indian construction group that builds power plants and office towers:
{"companyType": "Contractor", "realEstate": "Commercial", "infrastructure": "Power, Highway", "industrial": "Can't Say"}

Example 2 — A firm that only does advisory for airport projects:
{"companyType": "Consultant", "realEstate": "Can't Say", "infrastructure": "Airport", "industrial": "Can't Say"}

Example 3 — A real estate developer building residential townships and commercial malls:
{"companyType": "Developer", "realEstate": "Residential, Commercial", "infrastructure": "Can't Say", "industrial": "Can't Say"}

Example 4 — A software company (not construction-related):
{"companyType": "Can't Say", "realEstate": "Can't Say", "infrastructure": "Can't Say", "industrial": "Can't Say"}

Example 5 — A contractor building warehouses and highway bridges:
{"companyType": "Contractor", "realEstate": "Can't Say", "infrastructure": "Highway, Bridges", "industrial": "Warehouse"}`;
}

function buildUserMessage(companyName: string, searchResults: SearchResult[], scrapedContent: ScrapedContent | null): string {
  const searchContext = searchResults.length > 0
    ? searchResults
        .map((r, i) => `[${i + 1}] Title: "${r.title}"\n    URL: ${r.url}\n    Snippet: ${r.snippet}`)
        .join("\n\n")
    : "No search results available.";

  const websiteContext = scrapedContent && scrapedContent.text.length > 30
    ? `\n\nWEBSITE CONTENT (cleaned — scraped from ${companyName}'s website, junk removed):\n${scrapedContent.text.slice(0, 5000)}${scrapedContent.menuItems.length > 0 ? `\n\nNAVIGATION MENU ITEMS (indicates business areas):\n${scrapedContent.menuItems.slice(0, 15).join(", ")}` : ""}`
    : "\n\nWEBSITE CONTENT: Not available (scraping failed or returned empty content).";

  const contactsContext = scrapedContent && scrapedContent.rawContacts.length > 5
    ? `\n\nCONTACT INFORMATION (pre-extracted from website header, footer, and body HTML):\n${scrapedContent.rawContacts}\nIMPORTANT: Use these as the primary source for contactEmail and contactPhone fields. Only include publicly listed contacts.`
    : "";

  return `## COMPANY TO RESEARCH
Company name: ${companyName || "Unknown"}

## GOOGLE SEARCH RESULTS
${searchContext}
${websiteContext}
${contactsContext}

Based on all the above evidence, classify this company for the construction/civil engineering industry.`;
}

// ── Shared response parser for both Nvidia and GLM ──

function parseClassificationResponse(
  contentStr: string,
  searchResults: SearchResult[],
  scrapedContent: ScrapedContent | null,
  sourceLabel: string
): ClassificationResult {
  // Parse JSON from response
  let jsonStr = contentStr;
  const codeBlockMatch = contentStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) jsonStr = codeBlockMatch[1];
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.warn(`[${sourceLabel}] No JSON found in response:`, contentStr.slice(0, 300));
    return makeHeuristicFallback(searchResults, scrapedContent);
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate companyType
  let companyType: CompanyRoleType = "Can't Say";
  if (parsed.companyType && isValidCompanyRoleType(parsed.companyType)) {
    companyType = parsed.companyType;
  } else if (parsed.companyType) {
    const typeStr = parsed.companyType.toLowerCase();
    for (const valid of VALID_COMPANY_TYPES) {
      if (typeStr.includes(valid.toLowerCase())) {
        companyType = valid;
        break;
      }
    }
  }

  // Validate sector columns (comma-separated values or "Can't Say")
  const realEstate = validateSectorColumn(parsed.realEstate, VALID_REAL_ESTATE);
  const infrastructure = validateSectorColumn(parsed.infrastructure, VALID_INFRASTRUCTURE);
  const industrial = validateSectorColumn(parsed.industrial, VALID_INDUSTRIAL);

  const confidence = typeof parsed.confidence === "number"
    ? Math.max(0, Math.min(1, parsed.confidence))
    : 0.7;

  let confirmedName = "";
  if (typeof parsed.confirmedName === "string" && parsed.confirmedName.trim().length > 2) {
    confirmedName = parsed.confirmedName.trim().slice(0, 150);
    confirmedName = confirmedName.replace(/\s*(company profile|home|official website|welcome to)\s*$/i, "").trim();
    if (confirmedName.length < 2) confirmedName = "";
  }

  let summary = "";
  if (typeof parsed.summary === "string" && parsed.summary.length > 30) {
    summary = parsed.summary.trim();
    const hasAddressJunk = /^\d/.test(summary) && /Street|Road|Sector|Pin/.test(summary);
    const hasPhoneJunk = /\+?\d[\d\s\-]{8,}/.test(summary) && summary.length < 100;
    if (hasAddressJunk || hasPhoneJunk) {
      console.warn(`[${sourceLabel}] Summary contains address/phone junk, clearing it`);
      summary = "";
    }
  }

  const location = typeof parsed.location === "string" ? parsed.location.trim().slice(0, 120) : "";

  let contactEmail = "";
  if (typeof parsed.contactEmail === "string" && parsed.contactEmail.includes("@")) {
    contactEmail = parsed.contactEmail.trim().slice(0, 100);
  }

  let contactPhone = "";
  if (typeof parsed.contactPhone === "string" && parsed.contactPhone.replace(/[\s\-\(\)\+]/g, "").length >= 7) {
    contactPhone = parsed.contactPhone.trim().slice(0, 30);
  }

  console.log(`[${sourceLabel}] Result: confirmedName=${confirmedName}, companyType=${companyType}, realEstate=${realEstate}, infrastructure=${infrastructure}, industrial=${industrial}, confidence=${confidence}, summary=${summary.length}chars, location=${location}, email=${contactEmail}, phone=${contactPhone}`);

  return {
    companyType,
    realEstate,
    infrastructure,
    industrial,
    classificationConfidence: confidence,
    reasoning: parsed.reasoning || `${sourceLabel} classification`,
    summary,
    confirmedName,
    location,
    contactEmail,
    contactPhone,
  };
}

/**
 * Classify company using Nvidia NIM API (OpenAI-compatible).
 */
export async function classifyWithNvidia(
  searchResults: SearchResult[],
  scrapedContent: ScrapedContent | null,
  companyName: string,
  nvidiaApiKey: string,
  model: string = "openai/gpt-oss-120b"
): Promise<ClassificationResult> {
  if (!nvidiaApiKey) {
    console.log("[Nvidia] No API key provided, using heuristic fallback");
    const fallbackContent = {
      html: "",
      text: searchResults.map((r) => `${r.title} ${r.snippet}`).join(" "),
      menuItems: scrapedContent?.menuItems || [],
      rawContacts: scrapedContent?.rawContacts || "",
    };
    return heuristicClassify(fallbackContent);
  }

  const MAX_RETRIES = 2;
  const RETRY_DELAY_MS = 2000;
  const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

  const systemPrompt = buildSystemPrompt();
  const userMessage = buildUserMessage(companyName, searchResults, scrapedContent);

  console.log(`[Nvidia] Sending research request for "${companyName}" using model "${model}" (search results: ${searchResults.length}, scraped: ${scrapedContent ? scrapedContent.text.length + 'chars' : 'none'})`);

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_GLM_CLASSIFY_MS);

      const response = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${nvidiaApiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userMessage },
            ],
            temperature: 0.1,
            max_tokens: 2000,
            top_p: 0.95,
            stream: false,
          }),
          signal: controller.signal,
        }
      );

      clearTimeout(timeout);

      if (!response.ok) {
        const errorBody = await response.text().catch(() => "unknown");

        // Retry on transient errors (403, 429, 5xx)
        if (RETRYABLE_STATUS.has(response.status) && attempt <= MAX_RETRIES) {
          console.warn(`[Nvidia] Attempt ${attempt}/${MAX_RETRIES + 1} failed with status ${response.status}, retrying in ${RETRY_DELAY_MS}ms...`);
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }

        console.warn(`[Nvidia] API returned status ${response.status} after ${attempt} attempt(s): ${errorBody}`);
        return makeHeuristicFallback(searchResults, scrapedContent);
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      let contentStr = message?.content || "";

      if (!contentStr && (message as Record<string, unknown>)?.reasoning) {
        console.log("[Nvidia] content was empty, extracting from reasoning field");
        contentStr = String((message as Record<string, unknown>).reasoning);
      }
      if (!contentStr && (message as Record<string, unknown>)?.reasoning_content) {
        console.log("[Nvidia] content was empty, extracting from reasoning_content field");
        contentStr = String((message as Record<string, unknown>).reasoning_content);
      }

      if (!contentStr) {
        console.warn("[Nvidia] Empty response content after successful API call");
        return makeHeuristicFallback(searchResults, scrapedContent);
      }

      if (attempt > 1) {
        console.log(`[Nvidia] ✓ Succeeded on attempt ${attempt}/${MAX_RETRIES + 1}`);
      }
      console.log(`[Nvidia] Raw response (${contentStr.length} chars): ${contentStr.slice(0, 200)}...`);
      return parseClassificationResponse(contentStr, searchResults, scrapedContent, "Nvidia");

    } catch (error: unknown) {
      const errMs = TIMEOUT_GLM_CLASSIFY_MS / 1000;
      if (error instanceof Error && error.name === "AbortError") {
        console.warn(`[Nvidia] Attempt ${attempt} timed out after ${errMs}s`);
      } else if (error instanceof SyntaxError) {
        console.warn("[Nvidia] JSON parse error:", error.message);
        break; // Don't retry parse errors
      } else {
        console.warn(`[Nvidia] Attempt ${attempt} error:`, error instanceof Error ? error.message : error);
      }

      if (attempt <= MAX_RETRIES) {
        console.log(`[Nvidia] Retrying in ${RETRY_DELAY_MS}ms...`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      break;
    }
  }

  console.warn(`[Nvidia] All ${MAX_RETRIES + 1} attempts failed, using heuristic fallback`);
  return makeHeuristicFallback(searchResults, scrapedContent);
}

/**
 * Classify company using GLM via OpenRouter.
 */
export async function classifyWithGLM(
  searchResults: SearchResult[],
  scrapedContent: ScrapedContent | null,
  companyName: string,
  openrouterApiKey?: string
): Promise<ClassificationResult> {
  if (!openrouterApiKey) {
    console.log("[GLM] No OpenRouter API key provided, using heuristic fallback");
    const fallbackContent = {
      html: "",
      text: searchResults.map((r) => `${r.title} ${r.snippet}`).join(" "),
      menuItems: scrapedContent?.menuItems || [],
      rawContacts: scrapedContent?.rawContacts || "",
    };
    return heuristicClassify(fallbackContent);
  }

  try {
    const systemPrompt = buildSystemPrompt();
    const userMessage = buildUserMessage(companyName, searchResults, scrapedContent);

    console.log(`[GLM] Sending research request for "${companyName}" (search results: ${searchResults.length}, scraped: ${scrapedContent ? scrapedContent.text.length + 'chars' : 'none'})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_GLM_CLASSIFY_MS);

    const response = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openrouterApiKey}`,
        },
        body: JSON.stringify({
          model: "minimax/minimax-m2.5:free",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        }),
        signal: controller.signal,
      }
    );

    clearTimeout(timeout);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "unknown");
      console.warn(`[GLM] API returned status ${response.status}: ${errorBody}`);
      return makeHeuristicFallback(searchResults, scrapedContent);
    }

    const data = await response.json();
    const message = data.choices?.[0]?.message;
    let contentStr = message?.content || "";
    if (!contentStr && message?.reasoning) {
      console.log("[GLM] content was empty, extracting from reasoning field");
      contentStr = message.reasoning;
    }

    if (!contentStr) {
      console.warn("[GLM] Empty response content");
      return makeHeuristicFallback(searchResults, scrapedContent);
    }

    console.log(`[GLM] Raw response (${contentStr.length} chars): ${contentStr.slice(0, 200)}...`);
    return parseClassificationResponse(contentStr, searchResults, scrapedContent, "GLM");

  } catch (error: unknown) {
    const errMs = TIMEOUT_GLM_CLASSIFY_MS / 1000;
    if (error instanceof Error && error.name === "AbortError") {
      console.warn(`[GLM] Request timed out after ${errMs}s, using heuristic fallback`);
    } else if (error instanceof SyntaxError) {
      console.warn("[GLM] JSON parse error:", error.message);
    } else {
      console.warn("[GLM] Error:", error instanceof Error ? error.message : error);
    }
    return makeHeuristicFallback(searchResults, scrapedContent);
  }
}

/**
 * Create a heuristic fallback classification from available content.
 * Used when LLM is unavailable or fails.
 */
function makeHeuristicFallback(
  searchResults: SearchResult[],
  scrapedContent: ScrapedContent | null
): ClassificationResult {
  const allText = [
    searchResults.map((r) => `${r.title} ${r.snippet}`).join(" "),
    scrapedContent?.text || "",
    scrapedContent?.menuItems.join(" ") || "",
  ].join(" ").toLowerCase();

  const content: ScrapedContent = {
    html: "",
    text: allText,
    menuItems: scrapedContent?.menuItems || [],
    rawContacts: scrapedContent?.rawContacts || "",
  };

  const heuristic = heuristicClassify(content);

  let summary = "";
  if (searchResults.length > 0) {
    const bestSnippet = searchResults
      .map((r) => r.snippet)
      .filter((s) => s.length > 50 && !s.match(/^\[.*\]/))
      .sort((a, b) => b.length - a.length)[0];
    if (bestSnippet) {
      summary = bestSnippet.slice(0, 300);
    }
  }

  return {
    ...heuristic,
    summary,
  };
}
