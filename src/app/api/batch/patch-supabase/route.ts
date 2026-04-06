import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { cacheCompanyProfile } from '@/lib/cache';
import type { CompanyProfile } from '@/lib/types';

export const dynamic = 'force-dynamic';

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: HEADERS });
}

export async function POST(request: Request) {
  try {
    const { domain, companyData, convexUrl } = await request.json();

    if (!domain) {
      return NextResponse.json({ error: 'domain is required' }, { status: 400, headers: HEADERS });
    }

    if (!companyData) {
      return NextResponse.json({ error: 'companyData is required' }, { status: 400, headers: HEADERS });
    }

    console.log(`[Patch Supabase] Patching results for domain: ${domain}...`);

    // Update all matching rows in batch_extractions
    // We update name, type, sectors, description, location, contact info, and confidence
    const { data, error, count } = await supabase
      .from('batch_extractions')
      .update({
        company_name: companyData.company.name,
        confirmed_name: companyData.company.confirmedName || companyData.company.name,
        company_type: companyData.company.companyType,
        real_estate: companyData.company.realEstate,
        infrastructure: companyData.company.infrastructure,
        industrial: companyData.company.industrial,
        description: companyData.description || '',
        location: companyData.location || '',
        contact_email: companyData.contactEmail || '',
        contact_phone: companyData.contactPhone || '',
        confidence: companyData.confidence,
        partial: companyData.partial || false,
        updated_at: new Date().toISOString(),
        // We set status to completed if it was pending or error
        status: 'completed' 
      })
      .ilike('domain', domain) // Case-insensitive match on domain for 100% coverage
      .select('id');

    if (error) {
      console.error(`[Patch Supabase] Error patching domain ${domain}:`, error.message);
      return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
    }

    // ── ALSO UPDATE CONVEX CACHE (Secondary Safety) ──
    try {
      if (convexUrl) {
        const profile: CompanyProfile = {
          name: companyData.company.name,
          confirmedName: companyData.company.confirmedName || companyData.company.name,
          companyType: companyData.company.companyType,
          realEstate: companyData.company.realEstate,
          infrastructure: companyData.company.infrastructure,
          industrial: companyData.company.industrial,
          description: companyData.description || '',
          location: companyData.location || '',
          contactEmail: companyData.contactEmail || '',
          contactPhone: companyData.contactPhone || '',
          confidenceOverall: companyData.confidence,
          partial: companyData.partial || false,
          cachedAt: Date.now()
        };
        await cacheCompanyProfile(domain, profile, profile.partial, convexUrl, true);
        console.log(`[Patch Supabase] Also updated Convex cache for ${domain}`);
      }
    } catch (cacheErr) {
      console.warn(`[Patch Supabase] Failed to update secondary Convex cache:`, cacheErr);
    }

    console.log(`[Patch Supabase] Successfully patched ${count || data?.length || 0} rows for domain: ${domain}`);

    return NextResponse.json({
      success: true,
      patchedCount: count || data?.length || 0,
      domain
    }, { headers: HEADERS });

  } catch (err) {
    console.error('[Patch Supabase] Internal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: HEADERS });
  }
}
