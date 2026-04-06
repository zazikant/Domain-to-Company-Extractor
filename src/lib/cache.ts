import type { CompanyProfile } from "./types";
import { PARTIAL_TTL_MS, FULL_TTL_MS, TIMEOUT_CONVEX_READ_MS, TIMEOUT_CONVEX_WRITE_MS, TIMEOUT_SQLITE_READ_MS, TIMEOUT_SQLITE_WRITE_MS } from "./constants";

/**
 * Dual-layer caching:
 *   1. Convex (cloud, primary) — persistent, survives redeployments, 30-day TTL
 *   2. Prisma/SQLite (local, fallback) — works offline, same TTL
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
  // The SQLite cache gets the true partial value.
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
  sqliteStatus: 'hit' | 'miss' | 'error' | 'skipped';
  sqliteMs: number;
  sqliteDetail?: string;
};

/**
 * Get a cached company profile by domain.
 * Strategy: Convex (cloud) → SQLite (local fallback)
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
    sqliteStatus: 'skipped',
    sqliteMs: 0,
  };

  // ── Try Convex first (persistent cloud cache) ──
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

  // ── Fallback: Prisma/SQLite (local) ──
  const t1 = Date.now();
  try {
    const { db } = await import("./db");
    const cached = await db.companyCache.findUnique({ where: { domain: domain.toLowerCase() } });
    diag.sqliteMs = Date.now() - t1;

    if (!cached) {
      diag.sqliteStatus = 'miss';
      console.log(`[Cache] SQLite MISS for ${domain} (${diag.sqliteMs}ms)`);
      return { profile: null, diagnostic: diag };
    }

    const now = Date.now();
    const cachedAt = typeof cached.cachedAt === 'bigint' ? Number(cached.cachedAt) : cached.cachedAt;
    const ttlMs = typeof cached.ttlMs === 'bigint' ? Number(cached.ttlMs) : cached.ttlMs;
    if (now - cachedAt > ttlMs) {
      try { await db.companyCache.delete({ where: { id: cached.id } }); } catch { /* ignore */ }
      diag.sqliteStatus = 'miss';
      diag.sqliteDetail = `TTL expired (age=${Math.round((now - cachedAt) / 1000)}s, ttl=${Math.round(ttlMs / 1000)}s)`;
      console.log(`[Cache] SQLite TTL EXPIRED for ${domain}: ${diag.sqliteDetail}`);
      return { profile: null, diagnostic: diag };
    }

    diag.sqliteStatus = 'hit';
    console.log(`[Cache] SQLite HIT for ${domain} (${diag.sqliteMs}ms)`);
    return {
      profile: {
        name: cached.companyName,
        confirmedName: (cached as Record<string, unknown>).confirmedName as string || cached.companyName,
        companyType: (cached as Record<string, unknown>).companyType as string || "Can't Say",
        realEstate: (cached as Record<string, unknown>).realEstate as string || "Can't Say",
        infrastructure: (cached as Record<string, unknown>).infrastructure as string || "Can't Say",
        industrial: (cached as Record<string, unknown>).industrial as string || "Can't Say",
        description: cached.description || "",
        location: cached.location || "",
        contactEmail: cached.contactEmail || "",
        contactPhone: cached.contactPhone || "",
        cachedAt: cachedAt,
        confidenceOverall: cached.confidenceOverall,
        partial: cached.partial,
      },
      diagnostic: diag,
    };
  } catch (error) {
    diag.sqliteMs = Date.now() - t1;
    diag.sqliteStatus = 'error';
    diag.sqliteDetail = error instanceof Error ? error.message : String(error);
    console.error(`[Cache] SQLite read ERROR for ${domain} (${diag.sqliteMs}ms):`, diag.sqliteDetail);
    return { profile: null, diagnostic: diag };
  }
}

/**
 * Cache a company profile for a domain.
 * Strategy: Write to Convex (cloud) AND SQLite (local).
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
      console.warn(`[Cache] Convex write failed for ${domain} (falling back to local only)`);
    }
  }

  // ── Always write to SQLite as fallback ──
  const ttlMs = partial ? PARTIAL_TTL_MS : FULL_TTL_MS;
  try {
    const { db } = await import("./db");
    const existing = await Promise.race([
      db.companyCache.findUnique({ where: { domain: domain.toLowerCase() } }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_SQLITE_WRITE_MS)),
    ]);

    // Don't overwrite full results with partial ones, UNLESS force-refresh was requested
    if (!forceRefresh && existing && existing.partial === false && partial === true) {
      console.log(`[Cache] SQLite SKIP (existing full, new partial) for ${domain}`);
      return;
    }

    await Promise.race([
      db.companyCache.upsert({
        where: { domain: domain.toLowerCase() },
        create: {
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
          partial,
          cachedAt: profile.cachedAt,
          ttlMs,
        },
        update: {
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
          partial,
          cachedAt: profile.cachedAt,
          ttlMs,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("SQLite write timed out")), TIMEOUT_SQLITE_WRITE_MS)
      ),
    ]);
    console.log(`[Cache] SQLite WRITE OK for ${domain} | TTL=${partial ? '7d' : '30d'}`);
  } catch (error) {
    console.warn("[Cache] SQLite write failed (non-fatal):", error instanceof Error ? error.message : error);
  }
}
