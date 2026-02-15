import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  // Build the internal URL for the run endpoint
  const headersList = await headers();
  const host = headersList.get('host') ?? 'localhost:3000';
  const protocol = host.startsWith('localhost') ? 'http' : 'https';
  const runUrl = `${protocol}://${host}/api/ads-agent/run`;

  try {
    // Use CRON_SECRET for internal auth — this is a trusted server-side route
    const cronSecret = process.env.CRON_SECRET;
    const res = await fetch(runUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cronSecret ? { authorization: `Bearer ${cronSecret}` } : {}),
      },
    });

    const data = await res.json();

    return NextResponse.json(
      { triggered: true, runResponse: data },
      { status: res.status }
    );
  } catch (err) {
    return NextResponse.json(
      {
        triggered: false,
        error: err instanceof Error ? err.message : 'Failed to trigger run',
      },
      { status: 500 }
    );
  }
}
