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
    const { originalDomain, correctedDomain, companyData, convexUrl } = await request.json();

    if (!originalDomain || !correctedDomain || !companyData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400, headers: HEADERS });
    }

    const cleanOriginal = originalDomain.trim().toLowerCase();
    const cleanCorrected = correctedDomain.trim().toLowerCase();
    const wwwOriginal = `www.${cleanOriginal}`;

    console.log(`[Manual Map] Mapping ${cleanOriginal} (and ${wwwOriginal}) → ${cleanCorrected}...`);

    // 1. Update all matching rows in Supabase (raw domain and www variant)
    const { data, error, count } = await supabase
      .from('batch_extractions')
      .update({
        domain: cleanCorrected,
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
        status: 'completed' 
      })
      .or(`domain.ilike.${cleanOriginal},domain.ilike.${wwwOriginal}`)
      .select('id');

    if (error) {
      console.error(`[Manual Map] Supabase error mapping ${cleanOriginal}:`, error.message);
      return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
    }

    const patchedCount = count || data?.length || 0;

    // 2. Update Convex Cache for BOTH domains
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
        
        // Write perfect data to the ORIGINAL domain keys (both variants)
        await cacheCompanyProfile(cleanOriginal, profile, profile.partial, convexUrl, true);
        await cacheCompanyProfile(wwwOriginal, profile, profile.partial, convexUrl, true);
        
        // Ensure it's also keyed under the CORRECTED domain
        await cacheCompanyProfile(cleanCorrected, profile, profile.partial, convexUrl, true);
        
        console.log(`[Manual Map] Successfully updated cloud cache for ${cleanOriginal}, ${wwwOriginal} and ${cleanCorrected}`);
      }
    } catch (cacheErr) {
      console.warn(`[Manual Map] Failed to update secondary cloud cache:`, cacheErr);
    }

    console.log(`[Manual Map] Successfully re-mapped ${count || data?.length || 0} rows in Supabase`);

    return NextResponse.json({
      success: true,
      patchedCount: count || data?.length || 0,
      originalDomain,
      correctedDomain
    }, { headers: HEADERS });

  } catch (err) {
    console.error('[Manual Map] Internal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: HEADERS });
  }
}
