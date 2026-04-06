import { query } from "./_generated/server";
import { v } from "convex/values";

// Get cached company profile by domain. Returns null if not found or TTL expired.
// Note: TTL-expired entries are not cleaned up here (queries are read-only).
// They will be cleaned up on the next upsert or can be cleaned separately.
export const getByDomain = query({
  args: { domain: v.string() },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("companyCache")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain.toLowerCase()))
      .first();

    if (!cached) return null;

    // TTL expired — return null (don't delete, queries are read-only)
    if (Date.now() - cached.cachedAt > cached.ttlMs) {
      return null;
    }

    return cached;
  },
});
