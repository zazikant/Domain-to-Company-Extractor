import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!file.name.endsWith('.csv')) {
      return NextResponse.json({ error: 'Only CSV files are supported' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Max 5MB.' }, { status: 400 });
    }

    const text = await file.text();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

    if (lines.length === 0) {
      return NextResponse.json({ error: 'CSV file is empty' }, { status: 400 });
    }

    // Parse emails — skip header if it looks like one
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails: string[] = [];
    const skipped: string[] = [];
    let startIndex = 0;

    if (!emailRegex.test(lines[0])) {
      startIndex = 1; // skip header
    }

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];

      // Handle quoted CSV, comma-separated, or single column
      const parts = line.split(',').map(p => p.replace(/^"|"$/g, '').trim());
      const email = parts.find(p => emailRegex.test(p));

      if (email) {
        emails.push(email.toLowerCase());
      } else {
        skipped.push(line.length > 50 ? line.slice(0, 50) + '...' : line);
      }
    }

    if (emails.length === 0) {
      return NextResponse.json({ error: 'No valid email addresses found in CSV' }, { status: 400 });
    }

    // Deduplicate
    const uniqueEmails = [...new Set(emails)];

    // Generate a single batch_id for all rows
    const batchId = crypto.randomUUID();

    // Insert all emails with the same batch_id
    const rows = uniqueEmails.map(email => ({
      email,
      status: 'pending',
      batch_id: batchId,
    }));

    const { error: insertError } = await supabase
      .from('batch_extractions')
      .insert(rows);

    if (insertError) {
      console.error('[Batch Upload] Insert error:', insertError);
      return NextResponse.json({ error: `Database error: ${insertError.message}` }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      batchId,
      totalEmails: uniqueEmails.length,
      skippedRows: skipped.length,
      skippedExamples: skipped.slice(0, 5),
    });
  } catch (error) {
    console.error('[Batch Upload] Error:', error);
    return NextResponse.json({ error: 'Failed to process CSV file' }, { status: 500 });
  }
}
