import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [changeLogRes, proposalsRes, notificationRes] = await Promise.all([
      supabase
        .from('ads_agent_change_log')
        .select('created_at, action_type')
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
      supabase
        .from('ads_agent_decision_queue')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('ads_agent_notifications')
        .select('severity')
        .order('created_at', { ascending: false })
        .limit(1)
        .single(),
    ]);

    const lastRun = changeLogRes.data?.created_at ?? null;
    const lastAction = changeLogRes.data?.action_type ?? null;
    const activeProposals = proposalsRes.count ?? 0;

    let status: 'idle' | 'running' | 'error' = 'idle';
    if (notificationRes.data?.severity === 'critical') {
      status = 'error';
    }

    return NextResponse.json({
      agent: 'saffron',
      lastRun,
      lastAction,
      activeProposals,
      status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        agent: 'saffron',
        lastRun: null,
        lastAction: null,
        activeProposals: 0,
        status: 'error',
        error: err instanceof Error ? err.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
