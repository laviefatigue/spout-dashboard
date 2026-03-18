import { NextResponse } from 'next/server';
import { getAllCampaigns, getCampaignStats, switchWorkspace } from '@/lib/api/emailbison';
import { getCache, setCache, clearCache } from '@/lib/cache';
import type {
  FastAnalytics,
  CampaignComparisonItem,
  SequenceStepPerformance,
} from '@/lib/types/emailbison';

const SELERY_WORKSPACE_ID = 22;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cycleParam = url.searchParams.get('cycle');
    const refresh = url.searchParams.get('refresh') === 'true';

    const cacheKey = `fast-analytics-cycle-${cycleParam || 'all'}`;
    if (!refresh) {
      const cached = await getCache<FastAnalytics>(cacheKey);
      if (cached) {
        return NextResponse.json({ data: cached }, {
          headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
        });
      }
    } else {
      await clearCache('fast-analytics');
    }

    // Switch workspace
    await switchWorkspace(SELERY_WORKSPACE_ID).catch(() => {});

    // Fetch ALL campaigns (paginated)
    const campaigns = await getAllCampaigns();

    // Compute available cycles from the FULL unfiltered list
    const allCampaignsWithLeads = campaigns.filter(c => c.total_leads > 0);
    const availableCycles = [...new Set(
      allCampaignsWithLeads
        .map(c => {
          const match = c.name.match(/^Cycle\s+(\d+)/i);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((n): n is number => n !== null)
    )].sort((a, b) => a - b);

    // Filter by cycle if requested
    const cycleFilter = cycleParam ? parseInt(cycleParam, 10) : null;
    const cycleRegex = cycleFilter !== null ? new RegExp(`^Cycle\\s+${cycleFilter}\\b`, 'i') : null;

    const filteredCampaigns = cycleRegex
      ? campaigns.filter(c => cycleRegex.test(c.name))
      : campaigns;

    const activeCampaigns = filteredCampaigns.filter(c => c.emails_sent > 0);
    const filteredWithLeads = filteredCampaigns.filter(c => c.total_leads > 0);

    // Fetch stats for all active campaigns in parallel
    const now = new Date();
    const startDate = '2025-01-01';
    const endDate = now.toISOString().split('T')[0];

    const statsResults = await Promise.all(
      activeCampaigns.map(async (c) => {
        try {
          const { data } = await getCampaignStats(c.id, startDate, endDate);
          return { campaignId: c.id, stats: data };
        } catch {
          return { campaignId: c.id, stats: null };
        }
      })
    );

    const statsMap = new Map(statsResults.map(r => [r.campaignId, r.stats]));

    // Build hero metrics from campaign list objects
    const totalLeads = activeCampaigns.reduce((s, c) => s + c.total_leads, 0);
    const leadsContacted = activeCampaigns.reduce((s, c) => s + c.total_leads_contacted, 0);
    const emailsSent = activeCampaigns.reduce((s, c) => s + c.emails_sent, 0);
    const totalReplies = activeCampaigns.reduce((s, c) => s + c.unique_replies, 0);
    const totalInterested = activeCampaigns.reduce((s, c) => s + c.interested, 0);
    const totalBounced = activeCampaigns.reduce((s, c) => s + c.bounced, 0);

    // Campaign comparison — include all campaigns with leads loaded
    const campaignComparison: CampaignComparisonItem[] = filteredWithLeads
      .map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        totalLeads: c.total_leads,
        leadsContacted: c.total_leads_contacted,
        emailsSent: c.emails_sent,
        uniqueReplies: c.unique_replies,
        interested: c.interested,
        replyRate: c.total_leads_contacted > 0
          ? parseFloat(((c.unique_replies / c.total_leads_contacted) * 100).toFixed(2))
          : 0,
        interestRate: c.total_leads_contacted > 0
          ? parseFloat(((c.interested / c.total_leads_contacted) * 100).toFixed(2))
          : 0,
        bounceRate: c.emails_sent > 0
          ? parseFloat(((c.bounced / c.emails_sent) * 100).toFixed(2))
          : 0,
        completionPct: c.completion_percentage || 0,
      }))
      .sort((a, b) => b.interestRate - a.interestRate);

    // Sequence step performance — aggregate across filtered campaigns
    const stepAgg = new Map<number, {
      subjects: string[];
      sent: number;
      replies: number;
      interested: number;
      campaigns: number;
    }>();

    for (const campaign of activeCampaigns) {
      const stats = statsMap.get(campaign.id);
      if (!stats?.sequence_step_stats) continue;

      stats.sequence_step_stats.forEach((step, idx) => {
        const stepNum = idx + 1;
        const existing = stepAgg.get(stepNum) || {
          subjects: [], sent: 0, replies: 0, interested: 0, campaigns: 0,
        };
        existing.subjects.push(step.email_subject || `Step ${stepNum}`);
        existing.sent += step.sent;
        existing.replies += step.unique_replies;
        existing.interested += step.interested;
        existing.campaigns += 1;
        stepAgg.set(stepNum, existing);
      });
    }

    const totalCampaignCount = activeCampaigns.length;
    const sequenceStepPerformance: SequenceStepPerformance[] = Array.from(stepAgg.entries())
      .sort(([a], [b]) => a - b)
      .map(([stepNumber, data]) => ({
        stepNumber,
        subject: `Email ${stepNumber}`,
        totalSent: data.sent,
        totalReplies: data.replies,
        totalInterested: data.interested,
        replyRate: data.sent > 0
          ? parseFloat(((data.replies / data.sent) * 100).toFixed(2))
          : 0,
        interestRate: data.sent > 0
          ? parseFloat(((data.interested / data.sent) * 100).toFixed(2))
          : 0,
        campaignCount: data.campaigns,
      }))
      .filter(step =>
        step.stepNumber <= 4 &&
        step.campaignCount >= Math.max(Math.floor(totalCampaignCount * 0.3), 1) &&
        step.totalSent >= 100
      );

    const report: FastAnalytics = {
      workspaceName: 'Selery',
      heroMetrics: {
        totalCampaigns: filteredWithLeads.length,
        activeCampaigns: activeCampaigns.length,
        totalLeads,
        leadsContacted,
        emailsSent,
        totalReplies,
        totalInterested,
        avgReplyRate: leadsContacted > 0
          ? parseFloat(((totalReplies / leadsContacted) * 100).toFixed(2))
          : 0,
        avgInterestRate: leadsContacted > 0
          ? parseFloat(((totalInterested / leadsContacted) * 100).toFixed(2))
          : 0,
        avgBounceRate: emailsSent > 0
          ? parseFloat(((totalBounced / emailsSent) * 100).toFixed(2))
          : 0,
      },
      funnel: {
        totalLeads,
        contacted: leadsContacted,
        replied: totalReplies,
        interested: totalInterested,
      },
      campaignComparison,
      sequenceStepPerformance,
      availableCycles,
    };

    // Cache for 10 minutes
    await setCache(cacheKey, report, 600);

    return NextResponse.json({ data: report }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[Analytics/Fast] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate fast analytics' },
      { status: 500 }
    );
  }
}
