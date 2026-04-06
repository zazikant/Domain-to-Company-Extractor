import type { CompanyProfile } from "./types";
import { PARTIAL_TTL_MS, FULL_TTL_MS, TIMEOUT_CONVEX_READ_MS, TIMEOUT_CONVEX_WRITE_MS } from "./constants";

/**
 * Cloud-based caching using Convex:
 *   Convex (cloud, primary) — persistent, survives redeployments, 30-day TTL
 *
 * Convex HTTP endpoints:
 *   GET  https://<site-url>/cache?domain=example.com
 *   POST https://<site-url>/cache  { domain, companyName, ... }
 */

function toSiteUrl(deploymentUrl: string): string {
  const url = deploymentUrl.replace(/\/+$/, "");
  return url.replace(".convex.cloud", ".convex.site");
}

async function convexCacheGet(domain: string, siteUrl: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_CONVEX_READ_MS);

  try {
    const res = await fetch(`${siteUrl}/cache?domain=${encodeURIComponent(domain.toLowerCase())}`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    // Skip entries with empty company name (invalid/deleted cache entries)
    if (!(data.companyName as string)?.trim()) return null;
    return data as Record<string, unknown>;
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

async function convexCachePut(profile: CompanyProfile, domain: string, partial: boolean, siteUrl: string, forceRefresh: boolean = false): Promise<boolean> {
  // When force-refreshing, use FULL_TTL and override partial to false so the Convex
  // mutation's "don't overwrite full with partial" protection doesn't block the update.
  const effectivePartial = forceRefresh ? false : partial;
  const ttlMs = effectivePartial ? PARTIAL_TTL_MS : FULL_TTL_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_CONVEX_WRITE_MS);

  try {
    const res = await fetch(`${siteUrl}/cache`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: domain.toLowerCase(),
        companyName: profile.name,
        confirmedName: profile.confirmedName || profile.name,
        companyType: profile.companyType,
        realEstate: profile.realEstate,
        infrastructure: profile.infrastructure,
        industrial: profile.industrial,
        description: profile.description || "",
        location: profile.location || "",
        contactEmail: profile.contactEmail || "",
        contactPhone: profile.contactPhone || "",
        confidenceOverall: profile.confidenceOverall,
        partial: effectivePartial,
        cachedAt: profile.cachedAt,
        ttlMs,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

function convexToProfile(c: Record<string, unknown>): CompanyProfile {
  return {
    name: c.companyName as string,
    confirmedName: (c.confirmedName as string) || (c.companyName as string),
    companyType: (c.companyType as string) || "Can't Say",
    realEstate: (c.realEstate as string) || "Can't Say",
    infrastructure: (c.infrastructure as string) || "Can't Say",
    industrial: (c.industrial as string) || "Can't Say",
    description: (c.description as string) || "",
    location: (c.location as string) || "",
    contactEmail: (c.contactEmail as string) || "",
    contactPhone: (c.contactPhone as string) || "",
    cachedAt: c.cachedAt as number,
    confidenceOverall: c.confidenceOverall as number,
    partial: c.partial as boolean,
  };
}

/**
 * Cache diagnostic info — attached to every API response for debugging.
 */
export type CacheDiagnostic = {
  convexUrl: string;
  convexStatus: 'hit' | 'miss' | 'error' | 'skipped';
  convexMs: number;
};

/**
 * Get a cached company profile by domain.
 * Strategy: Convex (cloud)
 * Returns { profile, diagnostic } for debugging.
 */
export async function getCompanyByDomain(
  domain: string,
  convexDeploymentUrl: string = ""
): Promise<{ profile: CompanyProfile | null; diagnostic: CacheDiagnostic }> {
  const diag: CacheDiagnostic = {
    convexUrl: convexDeploymentUrl || '(none)',
    convexStatus: 'skipped',
    convexMs: 0,
  };

  // ── Try Convex ──
  if (convexDeploymentUrl) {
    const siteUrl = toSiteUrl(convexDeploymentUrl);
    const t0 = Date.now();
    try {
      const convexResult = await convexCacheGet(domain, siteUrl);
      diag.convexMs = Date.now() - t0;
      if (convexResult) {
        diag.convexStatus = 'hit';
        console.log(`[Cache] Convex HIT for ${domain} (${diag.convexMs}ms)`);
        return { profile: convexToProfile(convexResult), diagnostic: diag };
      }
      diag.convexStatus = 'miss';
      console.log(`[Cache] Convex MISS for ${domain} (${diag.convexMs}ms)`);
    } catch (error) {
      diag.convexMs = Date.now() - t0;
      diag.convexStatus = 'error';
      console.warn(`[Cache] Convex read error for ${domain} (${diag.convexMs}ms):`, error instanceof Error ? error.message : error);
    }
  }

  return { profile: null, diagnostic: diag };
}

/**
 * Cache a company profile for a domain.
 * Strategy: Write to Convex (cloud).
 */
export async function cacheCompanyProfile(
  domain: string,
  profile: CompanyProfile,
  partial: boolean,
  convexDeploymentUrl: string = "",
  forceRefresh: boolean = false
): Promise<void> {
  // ── Write to Convex (persistent cloud cache) ──
  if (convexDeploymentUrl) {
    const siteUrl = toSiteUrl(convexDeploymentUrl);
    const convexOk = await convexCachePut(profile, domain, partial, siteUrl, forceRefresh);
    if (convexOk) {
      console.log(`[Cache] Convex WRITE OK for ${domain} | partial=${partial}${forceRefresh ? ' (forceRefresh→effectivePartial=false)' : ''} | TTL=${forceRefresh && partial ? '30d (forced)' : (partial ? '7d' : '30d')}`);
    } else {
      console.warn(`[Cache] Convex write failed for ${domain}`);
    }
  }
}
