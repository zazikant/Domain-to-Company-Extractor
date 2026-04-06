import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  extractDomain,
  calculateSearchConfidence,
  discoverRealDomain,
  extractCompanyName,
  buildFinalProfile,
} from '@/lib/pipeline';
import {
  serperSearch,
  scrapeWithBrowserless,
  classifyWithGLM,
  classifyWithNvidia,
} from '@/lib/services';
import { getCompanyByDomain, cacheCompanyProfile } from '@/lib/cache';
import type { SearchResult, ScrapedContent, ClassificationResult } from '@/lib/types';

export const maxDuration = 90;

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

export async function POST(request: NextRequest) {
  try {
    const { batchId, apiKey, browserlessToken, llmModel, nvidiaApiKey, nvidiaModel, openrouterKey, convexUrl } = await request.json();

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400, headers: HEADERS });
    }

    // Pick the next pending row (FIFO by created_at)
    const { data: row, error: fetchError } = await supabase
      .from('batch_extractions')
      .select('id, email')
      .eq('batch_id', batchId)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1);

    if (fetchError) {
      return NextResponse.json({ error: fetchError.message }, { status: 500, headers: HEADERS });
    }

    if (!row || row.length === 0) {
      const { count } = await supabase
        .from('batch_extractions')
        .select('*', { count: 'exact', head: true })
        .eq('batch_id', batchId)
        .eq('status', 'pending');

      return NextResponse.json({
        done: true,
        remainingPending: count || 0,
      }, { headers: HEADERS });
    }

    const { id: rowId, email } = row[0];

    // Mark as processing
    await supabase
      .from('batch_extractions')
      .update({ status: 'processing', updated_at: new Date().toISOString() })
      .eq('id', rowId);

    // Helper: safely save error to Supabase (never throws)
    const saveError = async (domain: string | null, message: string) => {
      try {
        const safeDomain = domain || '';
        const safeMsg = String(message).slice(0, 500).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
        await supabase
          .from('batch_extractions')
          .update({
            status: 'error',
            domain: safeDomain,
            error_message: safeMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', rowId);
      } catch (dbErr) {
        console.error(`[Batch] Failed to save error to DB for row ${rowId}:`, dbErr);
      }
    };

    // Helper: copy a cached Supabase result to the current row
    const copyCachedRow = async (domain: string, sourceRow: Record<string, unknown>) => {
      await supabase
        .from('batch_extractions')
        .update({
          status: 'completed',
          domain: sourceRow.domain || domain,
          company_name: sourceRow.company_name || '',
          confirmed_name: sourceRow.confirmed_name || '',
          company_type: sourceRow.company_type || '',
          real_estate: sourceRow.real_estate || '',
          infrastructure: sourceRow.infrastructure || '',
          industrial: sourceRow.industrial || '',
          description: sourceRow.description || '',
          location: sourceRow.location || '',
          contact_email: sourceRow.contact_email || '',
          contact_phone: sourceRow.contact_phone || '',
          confidence: sourceRow.confidence || 0,
          partial: sourceRow.partial || false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);
    };

    // Helper: look up Supabase for previously completed batch result by domain
    const lookupSupabaseCache = async (lookupDomain: string): Promise<Record<string, unknown> | null> => {
      try {
        // Exclude the current row and the current batch to find from OTHER batches
        const { data: prevRows, error } = await supabase
          .from('batch_extractions')
          .select('*')
          .neq('batch_id', batchId)
          .eq('status', 'completed')
          .or(`domain.eq.${lookupDomain.toLowerCase()},domain.ilike.%${lookupDomain.toLowerCase()}%`)
          .order('confidence', { ascending: false, nullsFirst: false })
          .limit(1);

        if (error) {
          console.warn(`[Batch] Supabase cache lookup error for ${lookupDomain}:`, error.message);
          return null;
        }

        if (prevRows && prevRows.length > 0) {
          console.log(`[Batch] Supabase cache HIT for ${lookupDomain} (from batch ${prevRows[0].batch_id?.slice(0, 8)}, confidence=${prevRows[0].confidence})`);
          return prevRows[0] as Record<string, unknown>;
        }

        console.log(`[Batch] Supabase cache MISS for ${lookupDomain}`);
        return null;
      } catch (err) {
        console.warn(`[Batch] Supabase cache lookup exception for ${lookupDomain}:`, err);
        return null;
      }
    };

    try {
      // ═══ STEP 1: ExtractDomain ═══
      let domain: string;
      try {
        domain = extractDomain(email);
      } catch {
        await saveError(null, 'Invalid email address');
        return NextResponse.json({ processed: true, error: 'invalid_email' }, { headers: HEADERS });
      }
      console.log(`[Batch] Step 1 | ExtractDomain: "${email}" → ${domain}`);

      // ═══ STEP 2: GetCache (Convex → Supabase DB) ═══
      try {
        const { profile: cached, diagnostic } = await getCompanyByDomain(domain, convexUrl || '');
        if (cached) {
          console.log(`[Batch] Step 2 | Convex/SQLite cache HIT for ${domain} (convex=${diagnostic.convexStatus}, sqlite=${diagnostic.sqliteStatus})`);
          await supabase
            .from('batch_extractions')
            .update({
              status: 'completed',
              domain,
              company_name: cached.name,
              confirmed_name: cached.confirmedName || cached.name,
              company_type: cached.companyType,
              real_estate: cached.realEstate,
              infrastructure: cached.infrastructure,
              industrial: cached.industrial,
              description: cached.description || '',
              location: cached.location || '',
              contact_email: cached.contactEmail || '',
              contact_phone: cached.contactPhone || '',
              confidence: cached.confidenceOverall,
              partial: cached.partial,
              updated_at: new Date().toISOString(),
            })
            .eq('id', rowId);
          return NextResponse.json({ processed: true, email, companyName: cached.confirmedName || cached.name, cached: true }, { headers: HEADERS });
        }
      } catch (err) {
        console.warn(`[Batch] Step 2 | Convex/SQLite cache lookup error for ${domain}:`, err);
      }

      // ═══ STEP 2b: Supabase DB cache (check previous batch results) ═══
      try {
        const supabaseCached = await lookupSupabaseCache(domain);
        if (supabaseCached) {
          console.log(`[Batch] Step 2b | Supabase cache HIT for ${domain}`);
          await copyCachedRow(domain, supabaseCached);
          return NextResponse.json({ processed: true, email, companyName: (supabaseCached.confirmed_name || supabaseCached.company_name) as string, cached: true, cachedFrom: 'supabase' }, { headers: HEADERS });
        }
      } catch (err) {
        console.warn(`[Batch] Step 2b | Supabase cache lookup error for ${domain}:`, err);
      }

      // ═══ STEP 3: SerperSearch ═══
      let searchResults: SearchResult[] = [];
      try {
        searchResults = await serperSearch(domain, apiKey);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Search failed';
        await saveError(domain, `Serper search failed: ${msg}`);
        return NextResponse.json({ processed: true, error: 'serper_failed' }, { headers: HEADERS });
      }

      if (searchResults.length === 0) {
        await saveError(domain, `No search results found for domain "${domain}" — this domain may not exist or the company has no web presence`);
        return NextResponse.json({ processed: true, error: 'no_results' }, { headers: HEADERS });
      }
      console.log(`[Batch] Step 3 | SerperSearch: ${searchResults.length} results | first: "${searchResults[0].title}"`);

      // ═══ STEP 4: DiscoverRealDomain ═══
      const { domain: realDomain, discovered: domainDiscovered } = discoverRealDomain(searchResults, domain);
      console.log(`[Batch] Step 4 | Domain discovery: ${domain} → ${realDomain} (discovered: ${domainDiscovered})`);

      // ═══ STEP 4b: Cross-TLD cache check (Convex → Supabase DB, e.g., tatarealty.com → tatarealty.in) ═══
      if (domainDiscovered) {
        // 4b-i: Check Convex/SQLite for the discovered domain
        try {
          const { profile: discoveredCached, diagnostic: discDiag } = await getCompanyByDomain(realDomain, convexUrl || '');
          if (discoveredCached) {
            console.log(`[Batch] Step 4b | Cross-TLD Convex/SQLite cache HIT: ${domain} → ${realDomain} (convex=${discDiag.convexStatus}, sqlite=${discDiag.sqliteStatus})`);
            await supabase
              .from('batch_extractions')
              .update({
                status: 'completed',
                domain: realDomain,
                company_name: discoveredCached.name,
                confirmed_name: discoveredCached.confirmedName || discoveredCached.name,
                company_type: discoveredCached.companyType,
                real_estate: discoveredCached.realEstate,
                infrastructure: discoveredCached.infrastructure,
                industrial: discoveredCached.industrial,
                description: discoveredCached.description || '',
                location: discoveredCached.location || '',
                contact_email: discoveredCached.contactEmail || '',
                contact_phone: discoveredCached.contactPhone || '',
                confidence: discoveredCached.confidenceOverall,
                partial: discoveredCached.partial,
                updated_at: new Date().toISOString(),
              })
              .eq('id', rowId);
            return NextResponse.json({ processed: true, email, domain: realDomain, companyName: discoveredCached.confirmedName || discoveredCached.name, cached: true, cachedFrom: 'convex', discoveredDomain: realDomain }, { headers: HEADERS });
          }
        } catch (err) {
          console.warn(`[Batch] Step 4b | Cross-TLD Convex/SQLite cache lookup error for ${realDomain}:`, err);
        }

        // 4b-ii: Check Supabase DB for the discovered domain (previous batch results)
        try {
          const supabaseCached = await lookupSupabaseCache(realDomain);
          if (supabaseCached) {
            console.log(`[Batch] Step 4b | Cross-TLD Supabase cache HIT: ${domain} → ${realDomain}`);
            await copyCachedRow(realDomain, supabaseCached);
            return NextResponse.json({ processed: true, email, domain: realDomain, companyName: (supabaseCached.confirmed_name || supabaseCached.company_name) as string, cached: true, cachedFrom: 'supabase', discoveredDomain: realDomain }, { headers: HEADERS });
          }
        } catch (err) {
          console.warn(`[Batch] Step 4b | Cross-TLD Supabase cache lookup error for ${realDomain}:`, err);
        }
      }

      // ═══ STEP 5: CalculateSearchConfidence ═══
      const searchConfidence = calculateSearchConfidence(searchResults, domain);
      console.log(`[Batch] Step 5 | Search confidence: ${searchConfidence.search}`);

      // ═══ STEP 6: Extract company name ═══
      const companyName = extractCompanyName(searchResults[0].title);
      console.log(`[Batch] Company name: "${companyName}"`);

      // ═══ STEP 7: Browserless Scrape ═══
      let scrapedContent: ScrapedContent | null = null;
      const scrapeDomain = realDomain;
      try {
        scrapedContent = await scrapeWithBrowserless(scrapeDomain, browserlessToken);
        console.log(`[Batch] Step 7 | Scraping OK: ${scrapeDomain} → ${scrapedContent.text.length}chars`);
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.warn(`[Batch] Step 7 | Scraping FAILED for ${scrapeDomain}: ${errMsg}`);
      }

      // ═══ STEP 8: Classify with selected LLM ═══
      let classification: ClassificationResult;
      const usedNvidia = llmModel === 'nvidia';
      try {
        if (usedNvidia) {
          console.log(`[Batch] Step 8 | Using Nvidia model: ${nvidiaModel}`);
          classification = await classifyWithNvidia(
            searchResults,
            scrapedContent,
            companyName,
            nvidiaApiKey,
            nvidiaModel
          );
        } else {
          console.log(`[Batch] Step 8 | Using OpenRouter (MiniMax)`);
          classification = await classifyWithGLM(
            searchResults,
            scrapedContent,
            companyName,
            openrouterKey || undefined
          );
        }

        const usedLLM = !classification.reasoning.startsWith('heuristic fallback');
        const llmLabel = usedNvidia ? `Nvidia (${nvidiaModel})` : 'GLM (OpenRouter)';
        console.log(`[Batch] Step 8 | Classification source: ${usedLLM ? llmLabel : 'HEURISTIC FALLBACK'}`);
        console.log(`[Batch] Step 8 | LLM: type=${classification.companyType}, RE=${classification.realEstate}, INFRA=${classification.infrastructure}, IND=${classification.industrial}, conf=${classification.classificationConfidence}`);
      } catch (error: unknown) {
        console.warn(`[Batch] Step 8 | LLM failed entirely:`, error);
        const { heuristicClassify: hc } = await import("@/lib/pipeline");
        const fallbackContent = {
          html: "",
          text: searchResults.map((r) => `${r.title} ${r.snippet}`).join(" "),
          menuItems: scrapedContent?.menuItems || [],
          rawContacts: scrapedContent?.rawContacts || "",
        };
        classification = hc(fallbackContent);
      }

      // ═══ STEP 9: CombineResults ═══
      const { profile: finalProfile, confidence } = buildFinalProfile(
        searchResults,
        classification,
        searchConfidence.search
      );

      console.log(`[Batch] Step 9 | Combine: search=${searchConfidence.search}, scraping=${classification.classificationConfidence}, overall=${finalProfile.confidenceOverall}, partial=${finalProfile.partial}`);

      // ═══ STEP 10: CacheResult (cache under original domain, same as single extract) ═══
      try {
        await cacheCompanyProfile(domain, finalProfile, finalProfile.partial, convexUrl || '', false);
        console.log(`[Batch] Step 10 | Cached: ${domain} | partial=${finalProfile.partial}`);
      } catch { /* non-fatal */ }

      // Also cache under discovered domain if different (cross-TLD cache write)
      if (domainDiscovered && realDomain !== domain) {
        try {
          await cacheCompanyProfile(realDomain, finalProfile, finalProfile.partial, convexUrl || '', false);
          console.log(`[Batch] Step 10 | Also cached under discovered domain: ${realDomain}`);
        } catch { /* non-fatal */ }
      }

      // ═══ STEP 11: Update Supabase row ═══
      await supabase
        .from('batch_extractions')
        .update({
          status: 'completed',
          domain: realDomain,
          company_name: finalProfile.name,
          confirmed_name: finalProfile.confirmedName,
          company_type: finalProfile.companyType,
          real_estate: finalProfile.realEstate,
          infrastructure: finalProfile.infrastructure,
          industrial: finalProfile.industrial,
          description: finalProfile.description,
          location: finalProfile.location,
          contact_email: finalProfile.contactEmail,
          contact_phone: finalProfile.contactPhone,
          confidence: finalProfile.confidenceOverall,
          partial: finalProfile.partial,
          updated_at: new Date().toISOString(),
        })
        .eq('id', rowId);

      return NextResponse.json({
        processed: true,
        email,
        domain: realDomain,
        companyName: finalProfile.confirmedName || finalProfile.name,
      }, { headers: HEADERS });

    } catch (pipelineError: unknown) {
      const msg = pipelineError instanceof Error ? pipelineError.message : 'Unknown pipeline error';
      console.error(`[Batch] Pipeline error for ${email}:`, msg);
      await saveError(typeof domain !== 'undefined' ? domain : null, `Pipeline error: ${msg}`);

      return NextResponse.json({ processed: true, error: msg }, { headers: HEADERS });
    }

  } catch (error) {
    console.error('[Batch Process] Error:', error);
    return NextResponse.json({ error: 'Batch processing failed' }, { status: 500, headers: HEADERS });
  }
}
