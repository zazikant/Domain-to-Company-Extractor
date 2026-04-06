import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  companyCache: defineTable({
    domain: v.string(),
    companyName: v.string(),
    confirmedName: v.string(),
    companyType: v.string(),       // Developer | Contractor | Consultant | Can't Say
    realEstate: v.optional(v.string()),        // e.g. "Commercial" or "Commercial, Residential" or "Can't Say"
    infrastructure: v.optional(v.string()),    // e.g. "Power, Highway" or "Can't Say"
    industrial: v.optional(v.string()),        // e.g. "Warehouse" or "Can't Say"
    // Legacy fields (kept for backward compat with existing docs — will be ignored)
    sector: v.optional(v.string()),
    description: v.string(),
    location: v.string(),
    contactEmail: v.string(),
    contactPhone: v.string(),
    confidenceOverall: v.number(),
    partial: v.boolean(),
    cachedAt: v.number(),
    ttlMs: v.number(),
  }).index("by_domain", ["domain"]),
});
