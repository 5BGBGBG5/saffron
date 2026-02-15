import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    agent: 'saffron',
    timestamp: new Date().toISOString(),
  });
}
