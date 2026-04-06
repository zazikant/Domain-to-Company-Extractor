import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400, headers: HEADERS });
    }

    const { data, error } = await supabase
      .from('batch_extractions')
      .select('*')
      .eq('batch_id', batchId)
      .order('created_at', { ascending: true });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
    }

    // Compute summary stats
    const total = data?.length || 0;
    const completed = data?.filter(r => r.status === 'completed').length || 0;
    const errors = data?.filter(r => r.status === 'error').length || 0;
    const processing = data?.filter(r => r.status === 'processing').length || 0;
    const pending = data?.filter(r => r.status === 'pending').length || 0;

    return NextResponse.json({
      batchId,
      total,
      completed,
      errors,
      processing,
      pending,
      rows: data || [],
    }, { headers: HEADERS });
  } catch (error) {
    console.error('[Batch Status] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch batch status' }, { status: 500, headers: HEADERS });
  }
}
