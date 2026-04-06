import { mutation } from "./_generated/server";
import { v } from "convex/values";

// Store or update a cached company profile. Won't overwrite full results with partial.
export const upsert = mutation({
  args: {
    domain: v.string(),
    companyName: v.string(),
    confirmedName: v.string(),
    companyType: v.string(),
    realEstate: v.string(),
    infrastructure: v.string(),
    industrial: v.string(),
    description: v.string(),
    location: v.string(),
    contactEmail: v.string(),
    contactPhone: v.string(),
    confidenceOverall: v.number(),
    partial: v.boolean(),
    cachedAt: v.number(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("companyCache")
      .withIndex("by_domain", (q) => q.eq("domain", args.domain.toLowerCase()))
      .first();

    // Don't overwrite full results with partial ones
    if (existing && existing.partial === false && args.partial === true) {
      return existing._id;
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        companyName: args.companyName,
        confirmedName: args.confirmedName,
        companyType: args.companyType,
        realEstate: args.realEstate,
        infrastructure: args.infrastructure,
        industrial: args.industrial,
        description: args.description,
        location: args.location,
        contactEmail: args.contactEmail,
        contactPhone: args.contactPhone,
        confidenceOverall: args.confidenceOverall,
        partial: args.partial,
        cachedAt: args.cachedAt,
        ttlMs: args.ttlMs,
      });
      return existing._id;
    }

    return await ctx.db.insert("companyCache", {
      domain: args.domain.toLowerCase(),
      ...args,
    });
  },
});
