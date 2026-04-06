import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const batchId = searchParams.get('batchId');
    const limit = parseInt(searchParams.get('limit') || '0', 10);

    if (!batchId) {
      return NextResponse.json({ error: 'batchId is required' }, { status: 400 });
    }

    // Fetch completed rows from Supabase
    let query = supabase
      .from('batch_extractions')
      .select('*')
      .eq('batch_id', batchId)
      .in('status', ['completed', 'error'])
      .order('created_at', { ascending: true });

    if (limit > 0) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: 'No completed or error records found' }, { status: 404 });
    }

    // Build CSV with all column names
    const headers = [
      'Email',
      'Domain',
      'Status',
      'Company Name',
      'Confirmed Name',
      'Company Type',
      'Real Estate',
      'Infrastructure',
      'Industrial',
      'Location',
      'Contact Email',
      'Contact Phone',
      'Confidence',
      'Partial',
      'Description',
      'Error Message',
    ];

    const csvRows = data.map(row => [
      csvEscape(row.email || ''),
      csvEscape(row.domain || ''),
      csvEscape(row.status || ''),
      csvEscape(row.company_name || ''),
      csvEscape(row.confirmed_name || ''),
      csvEscape(row.company_type || ''),
      csvEscape(row.real_estate || ''),
      csvEscape(row.infrastructure || ''),
      csvEscape(row.industrial || ''),
      csvEscape(row.location || ''),
      csvEscape(row.contact_email || ''),
      csvEscape(row.contact_phone || ''),
      row.confidence != null ? Math.round(row.confidence * 100) + '%' : '',
      row.partial ? 'Yes' : 'No',
      csvEscape(row.description || ''),
      csvEscape(row.error_message || ''),
    ]);

    const csv = [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n');
    const filename = `batch-results-${batchId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[Batch Download] Error:', error);
    return NextResponse.json({ error: 'Failed to download results' }, { status: 500 });
  }
}

function csvEscape(value: string): string {
  if (!value) return '';
  // If value contains comma, quote, or newline, wrap in quotes and escape internal quotes
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
