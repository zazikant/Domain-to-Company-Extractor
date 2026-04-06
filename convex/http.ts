import { httpRouter, httpActionGeneric } from "convex/server";
import { api } from "./_generated/api";

const http = httpRouter();

/**
 * GET /cache?domain=example.com
 * Retrieve a cached company profile by domain.
 */
http.route({
  path: "/cache",
  method: "GET",
  handler: httpActionGeneric(async (ctx, request) => {
    const domain = new URL(request.url).searchParams.get("domain");
    if (!domain) {
      return new Response(JSON.stringify({ error: "domain query parameter required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const cached = await ctx.runQuery(api.companyCache.getByDomain, { domain });
    return new Response(JSON.stringify(cached), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

/**
 * POST /cache
 * Store or update a cached company profile.
 */
http.route({
  path: "/cache",
  method: "POST",
  handler: httpActionGeneric(async (ctx, request) => {
    const body = await request.json();
    if (!body || !body.domain) {
      return new Response(JSON.stringify({ error: "domain is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const id = await ctx.runMutation(api.companyCacheMutations.upsert, {
      domain: body.domain,
      companyName: body.companyName || "",
      confirmedName: body.confirmedName || "",
      companyType: body.companyType || "Can't Say",
      realEstate: body.realEstate || "Can't Say",
      infrastructure: body.infrastructure || "Can't Say",
      industrial: body.industrial || "Can't Say",
      description: body.description || "",
      location: body.location || "",
      contactEmail: body.contactEmail || "",
      contactPhone: body.contactPhone || "",
      confidenceOverall: body.confidenceOverall || 0,
      partial: body.partial || false,
      cachedAt: body.cachedAt || Date.now(),
      ttlMs: body.ttlMs || 30 * 24 * 60 * 60 * 1000,
    });

    return new Response(JSON.stringify({ success: true, id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
