import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
} as const;

export async function POST(request: NextRequest) {
  try {
    const { batchId } = await request.json();

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400, headers: HEADERS });
    }

    // Set all pending/processing rows to cancelled
    const { error } = await supabase
      .from('batch_extractions')
      .update({ status: 'error', error_message: 'Cancelled by user', updated_at: new Date().toISOString() })
      .eq('batch_id', batchId)
      .in('status', ['pending', 'processing']);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: HEADERS });
    }

    return NextResponse.json({ success: true }, { headers: HEADERS });
  } catch (error) {
    console.error('[Batch Cancel] Error:', error);
    return NextResponse.json({ error: 'Failed to cancel batch' }, { status: 500, headers: HEADERS });
  }
}
