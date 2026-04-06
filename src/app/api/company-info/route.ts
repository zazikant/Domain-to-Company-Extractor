import { NextRequest, NextResponse } from "next/server";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { extractDomain, calculateSearchConfidence, discoverRealDomain, extractCompanyName, buildFinalProfile } from "@/lib/pipeline";
import { serperSearch, scrapeWithBrowserless, classifyWithGLM, classifyWithNvidia } from "@/lib/services";
import { getCompanyByDomain, cacheCompanyProfile, type CacheDiagnostic } from "@/lib/cache";
import { checkRateLimit, initRedis } from "@/lib/rate-limit";
import type { SearchResult, ScrapedContent, ClassificationResult } from "@/lib/types";

// Allow up to 90 seconds for the full pipeline (Serper + Browserless + GLM)
export const maxDuration = 90;

const DEFAULT_UPSTASH_URL = "https://cuddly-newt-74293.upstash.io";
const DEFAULT_UPSTASH_TOKEN = "gQAAAAAAASI1AAIncDI3MWYzZDk5NDI1NDc0NzhiYWJkZWE0ZTVkYjFiYjQzY3AyNzQyOTM";

// Build version — set at build time
const BUILD_TIME = new Date().toISOString();

// File-based request logging for debugging - use environment variable or fallback to local logs dir
const LOG_DIR = process.env.LOG_DIR || join(process.cwd(), "logs");
const LOG_FILE = join(LOG_DIR, "request-log.txt");

function logToFile(entry: Record<string, unknown>) {
  try {
    // Only attempt to log if LOG_DIR is writable or we're not on Vercel
    // On Vercel, this will likely fail, which we catch silently.
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n";
    writeFileSync(LOG_FILE, line, { flag: "a" });
  } catch (err) {
    // Silently fail logging if filesystem is read-only (standard for Vercel/serverless)
    if (process.env.NODE_ENV !== 'production') {
      console.warn("[Logging] Failed to write to log file:", err instanceof Error ? err.message : String(err));
    }
  }
}

export async function POST(request: NextRequest) {
  // Extract Upstash Redis credentials from headers
  const upstashUrl = request.headers.get("x-upstash-redis-url")?.trim() || DEFAULT_UPSTASH_URL;
  const upstashToken = request.headers.get("x-upstash-redis-token")?.trim() || DEFAULT_UPSTASH_TOKEN;
  initRedis(upstashUrl, upstashToken);

  // Convex deployment URL for cloud caching
  const convexUrl = request.headers.get("x-convex-url")?.trim() || "";

  // Force refresh: skip cache read, always run full pipeline & overwrite cache
  const forceRefresh = request.headers.get("x-force-refresh")?.trim() === "true";

  // Log all incoming headers for debugging (BEFORE any processing)
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => { allHeaders[key] = value; });
  logToFile({ event: "REQUEST_RECEIVED", headers: allHeaders, url: request.url });

  // Rate limiting
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rateLimit = await checkRateLimit(ip);

  const headers: Record<string, string> = {
    "X-RateLimit-Limit": "1000",
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "Cache-Control": "no-store",
  };
  if (rateLimit.resetAt) {
    headers["Retry-After"] = String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000));
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "rate_limit_exceeded", message: "Too many requests. Please try again later." },
      { status: 429, headers }
    );
  }

  try {
    // Extract API keys
    const serperApiKey = request.headers.get("x-serper-api-key");
    const browserlessToken = request.headers.get("x-browserless-token");
    const openrouterApiKey = request.headers.get("x-openrouter-api-key");
    const nvidiaApiKey = request.headers.get("x-nvidia-api-key")?.trim() || "";
    const llmModel = request.headers.get("x-llm-model")?.trim() || "openrouter";
    const nvidiaModelName = request.headers.get("x-nvidia-model")?.trim() || "openai/gpt-oss-120b";

    if (!serperApiKey) return NextResponse.json({ error: "invalid_api_key", source: "serper", message: "X-Serper-Api-Key header is required" }, { status: 401, headers });
    if (!browserlessToken) return NextResponse.json({ error: "invalid_api_key", source: "browserless", message: "X-Browserless-Token header is required" }, { status: 401, headers });

    // Parse body
    let body: { email?: string };
    try { body = await request.json(); } catch {
      return NextResponse.json({ error: "invalid_email", message: "Request body must be valid JSON" }, { status: 400, headers });
    }
    const email = body?.email;
    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json({ error: "invalid_email", message: "A valid email address is required" }, { status: 400, headers });
    }

    const pipelineStartMs = Date.now();

    // ═══ STEP 1: ExtractDomain ═══
    let domain: string;
    try { domain = extractDomain(email); } catch {
      return NextResponse.json({ error: "invalid_email", message: "Could not extract domain from email" }, { status: 400, headers });
    }
    console.log(`[Pipeline] Step 1 | ExtractDomain: "${email}" → ${domain}`);
    logToFile({ event: "DOMAIN_EXTRACTED", email, domain, forceRefresh, convexUrl });

    // ═══ STEP 2: GetCache (skipped when force-refresh) ═══
    if (!forceRefresh) {
      try {
        const { profile: cached, diagnostic } = await getCompanyByDomain(domain, convexUrl);
        if (cached) {
          console.log(`[Pipeline] Step 2 | Cache HIT for ${domain} | diag=${JSON.stringify(diagnostic)}`);
          logToFile({ event: "CACHE_HIT", domain, diagnostic });
          return NextResponse.json({
            company: {
              name: cached.name,
              confirmedName: cached.confirmedName || cached.name,
              companyType: cached.companyType,
              realEstate: cached.realEstate,
              infrastructure: cached.infrastructure,
              industrial: cached.industrial,
            },
            description: cached.description || "",
            location: cached.location || "",
            contactEmail: cached.contactEmail || "",
            contactPhone: cached.contactPhone || "",
            confidence: cached.confidenceOverall,
            partial: cached.partial,
            cached: true,
            domain: domain,
            cacheDiagnostic: diagnostic,
            buildTime: BUILD_TIME,
          }, { status: 200, headers });
        }
        logToFile({ event: "CACHE_MISS", domain, diagnostic });
        console.log(`[Pipeline] Step 2 | Cache MISS for ${domain} | diag=${JSON.stringify(diagnostic)}`);
      } catch (err) {
        console.error(`[Pipeline] Step 2 | Cache lookup error:`, err);
      }
    } else {
      logToFile({ event: "CACHE_SKIPPED_FORCE_REFRESH", domain });
      console.log(`[Pipeline] Step 2 | Cache SKIPPED (force-refresh=true) for ${domain}`);
    }

    // ═══ STEP 3: SerperSearch ═══
    let searchResults: SearchResult[] = [];
    try {
      searchResults = await serperSearch(domain, serperApiKey);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === "SERPER_AUTH_FAILED") {
        return NextResponse.json({ error: "invalid_api_key", source: "serper", message: "Invalid Serper API key" }, { status: 401, headers });
      }
      return NextResponse.json({ error: "extraction_failed", source: "serper", message: "Search service failed" }, { status: 503, headers });
    }

    if (searchResults.length === 0) {
      return NextResponse.json({ error: "extraction_failed", source: "serper", message: "No search results found for this domain" }, { status: 404, headers });
    }
    console.log(`[Pipeline] Step 3 | SerperSearch: ${searchResults.length} results | first: "${searchResults[0].title}"`);

    // ═══ STEP 4: DiscoverRealDomain ═══
    const { domain: realDomain, discovered: domainDiscovered } = discoverRealDomain(searchResults, domain);
    console.log(`[Pipeline] Step 4 | Domain discovery: ${domain} → ${realDomain} (discovered: ${domainDiscovered})`);

    // ═══ STEP 4b: Cross-TLD cache check (e.g., tatarealty.com → tatarealty.in) ═══
    if (domainDiscovered && !forceRefresh) {
      try {
        const { profile: discoveredCached, diagnostic: discDiag } = await getCompanyByDomain(realDomain, convexUrl);
        if (discoveredCached) {
          console.log(`[Pipeline] Step 4b | Cross-TLD cache HIT: ${domain} → ${realDomain} | diag=${JSON.stringify(discDiag)}`);
          logToFile({ event: "CROSS_TLD_CACHE_HIT", originalDomain: domain, discoveredDomain: realDomain, diagnostic: discDiag });
          return NextResponse.json({
            company: {
              name: discoveredCached.name,
              confirmedName: discoveredCached.confirmedName || discoveredCached.name,
              companyType: discoveredCached.companyType,
              realEstate: discoveredCached.realEstate,
              infrastructure: discoveredCached.infrastructure,
              industrial: discoveredCached.industrial,
            },
            description: discoveredCached.description || "",
            location: discoveredCached.location || "",
            contactEmail: discoveredCached.contactEmail || "",
            contactPhone: discoveredCached.contactPhone || "",
            confidence: discoveredCached.confidenceOverall,
            partial: discoveredCached.partial,
            cached: true,
            domain: domain,
            discoveredDomain: realDomain,
            cacheDiagnostic: discDiag,
            buildTime: BUILD_TIME,
          }, { status: 200, headers });
        }
      } catch (err) {
        console.warn(`[Pipeline] Step 4b | Cross-TLD cache lookup error for ${realDomain}:`, err);
      }
    }

    // ═══ STEP 5: CalculateSearchConfidence ═══
    const searchConfidence = calculateSearchConfidence(searchResults, domain);
    console.log(`[Pipeline] Step 5 | Search confidence: ${searchConfidence.search} ${searchConfidence.search < 0.7 ? '→ LOW PATH' : '→ HIGH PATH'}`);

    const companyName = extractCompanyName(searchResults[0].title);
    console.log(`[Pipeline] Company name: "${companyName}"`);

    // ═══ STEP 6: Browserless Scrape ═══
    let scrapedContent: ScrapedContent | null = null;
    const scrapeDomain = realDomain;
    try {
      scrapedContent = await scrapeWithBrowserless(scrapeDomain, browserlessToken);
      console.log(`[Pipeline] Step 6 | Scraping OK: ${scrapeDomain} → ${scrapedContent.text.length}chars cleaned`);
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[Pipeline] Step 6 | Scraping FAILED for ${scrapeDomain}: ${errMsg}`);
    }

    // ═══ STEP 7: Classify with selected LLM ═══
    let classification: ClassificationResult;
    const usedNvidia = llmModel === "nvidia";
    try {
      if (usedNvidia) {
        console.log(`[Pipeline] Step 7 | Using Nvidia model: ${nvidiaModelName}`);
        classification = await classifyWithNvidia(
          searchResults,
          scrapedContent,
          companyName,
          nvidiaApiKey,
          nvidiaModelName
        );
      } else {
        console.log(`[Pipeline] Step 7 | Using OpenRouter (MiniMax)`);
        classification = await classifyWithGLM(
          searchResults,
          scrapedContent,
          companyName,
          openrouterApiKey || undefined
        );
      }

      const usedLLM = !classification.reasoning.startsWith('heuristic fallback');
      const llmLabel = usedNvidia ? `Nvidia (${nvidiaModelName})` : 'GLM (OpenRouter)';
      console.log(`[Pipeline] Step 7 | Classification source: ${usedLLM ? llmLabel : 'HEURISTIC FALLBACK (keyword matching)'}`);
      if (!usedLLM) {
        console.warn(`[Pipeline] Step 7 | ⚠️ LLM was NOT used! ${usedNvidia ? `Nvidia key ${nvidiaApiKey ? 'provided but failed' : 'MISSING'}` : `OpenRouter key ${openrouterApiKey ? 'provided but failed' : 'MISSING'}`}`);
      }
      console.log(`[Pipeline] Step 7 | LLM: type=${classification.companyType}, RE=${classification.realEstate}, INFRA=${classification.infrastructure}, IND=${classification.industrial}, conf=${classification.classificationConfidence}, summary=${classification.summary.length}chars`);
    } catch (error: unknown) {
      console.warn(`[Pipeline] Step 7 | LLM failed entirely:`, error);
      const { heuristicClassify: hc } = await import("@/lib/pipeline");
      const fallbackContent = {
        html: "",
        text: searchResults.map((r) => `${r.title} ${r.snippet}`).join(" "),
        menuItems: scrapedContent?.menuItems || [],
        rawContacts: scrapedContent?.rawContacts || "",
      };
      classification = hc(fallbackContent);
    }

    // ═══ STEP 8: CombineResults ═══
    const { profile: finalProfile, confidence } = buildFinalProfile(
      searchResults,
      classification,
      searchConfidence.search
    );

    console.log(`[Pipeline] Step 8 | Combine: search=${searchConfidence.search}, scraping=${classification.classificationConfidence}, overall=${finalProfile.confidenceOverall}, partial=${finalProfile.partial}`);

    const pipelineMs = Date.now() - pipelineStartMs;
    console.log(`[Pipeline] TOTAL: ${pipelineMs}ms | ${domain} → ${realDomain} | "${finalProfile.name}" | type=${finalProfile.companyType} RE=${finalProfile.realEstate} INFRA=${finalProfile.infrastructure} IND=${finalProfile.industrial} conf=${finalProfile.confidenceOverall}`);

    // ═══ STEP 9: CacheResult ═══
    try { await cacheCompanyProfile(domain, finalProfile, finalProfile.partial, convexUrl, forceRefresh); } catch { /* non-fatal */ }
    console.log(`[Pipeline] Step 9 | Cached: ${domain} | partial=${finalProfile.partial} | TTL=${finalProfile.partial ? '7d' : '30d'}`);

    // Also cache under discovered domain if different (cross-TLD cache write)
    if (domainDiscovered && realDomain !== domain) {
      try { await cacheCompanyProfile(realDomain, finalProfile, finalProfile.partial, convexUrl, forceRefresh); } catch { /* non-fatal */ }
      console.log(`[Pipeline] Step 9 | Also cached under discovered domain: ${realDomain}`);
    }

    // ═══ HTTP 200 Response ═══
    const usedLLM = !classification.reasoning.startsWith('heuristic fallback');
    const llmLabel = usedNvidia ? `Nvidia (${nvidiaModelName})` : 'GLM (OpenRouter)';
    logToFile({ event: "PIPELINE_COMPLETE", domain, pipelineMs, confidence: finalProfile.confidenceOverall, companyType: finalProfile.companyType });
    return NextResponse.json({
      company: {
        name: finalProfile.name,
        confirmedName: finalProfile.confirmedName,
        companyType: finalProfile.companyType,
        realEstate: finalProfile.realEstate,
        infrastructure: finalProfile.infrastructure,
        industrial: finalProfile.industrial,
      },
      description: finalProfile.description,
      location: finalProfile.location,
      contactEmail: finalProfile.contactEmail,
      contactPhone: finalProfile.contactPhone,
      confidence: finalProfile.confidenceOverall,
      partial: finalProfile.partial,
      cached: false,
      domain: domain,
      discoveredDomain: domainDiscovered ? realDomain : undefined,
      pipelineInfo: {
        scrapingDomain: scrapeDomain,
        scrapedBytes: scrapedContent ? scrapedContent.text.length : 0,
        usedGLM: usedLLM,
        classificationSource: usedLLM ? llmLabel : 'Heuristic (keyword matching)',
        llmModel: usedNvidia ? nvidiaModelName : 'openrouter',
        pipelineMs,
      },
      buildTime: BUILD_TIME,
    }, { status: 200, headers });

  } catch (error: unknown) {
    console.error("[API] Unexpected error:", error);
    logToFile({ event: "UNEXPECTED_ERROR", error: error instanceof Error ? error.message : String(error) });
    const message = error instanceof Error ? error.message : "An unexpected error occurred";
    return NextResponse.json({ error: "internal_error", message, buildTime: BUILD_TIME }, { status: 500, headers });
  }
}
