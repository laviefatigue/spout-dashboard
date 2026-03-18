import { NextResponse } from 'next/server';
import { getAllSenderEmails, getAllCampaigns, getCampaignSenderEmails, switchWorkspace } from '@/lib/api/emailbison';
import type {
  SenderEmail,
  EmailProvider,
  ProviderStats,
  DomainStats,
  TopSender,
  SenderAnalytics,
} from '@/lib/types/emailbison';

const SELERY_WORKSPACE_ID = 22;

function detectProvider(sender: SenderEmail): EmailProvider {
  const type = sender.type?.toLowerCase() || '';
  if (type.includes('google')) return 'Google';
  if (type.includes('microsoft')) return 'Microsoft';
  const tagNames = sender.tags?.map(t => t.name.toLowerCase()) || [];
  if (tagNames.some(t => t.includes('google') || t.includes('gmail'))) return 'Google';
  if (tagNames.some(t => t.includes('outlook') || t.includes('microsoft'))) return 'Microsoft';
  return 'Other';
}

function rate(num: number, denom: number): number {
  return denom > 0 ? parseFloat(((num / denom) * 100).toFixed(2)) : 0;
}

function buildAnalytics(senders: SenderEmail[]): SenderAnalytics {
  const providerMap = new Map<EmailProvider, Omit<ProviderStats, 'replyRate' | 'bounceRate' | 'interestRate'>>();
  const domainMap = new Map<string, Omit<DomainStats, 'replyRate' | 'bounceRate' | 'interestRate'>>();

  let connectedCount = 0;

  for (const s of senders) {
    const provider = detectProvider(s);
    const domain = s.email.split('@')[1] || 'unknown';
    if (s.status?.toLowerCase() === 'connected') connectedCount++;

    // Provider aggregation
    const prov = providerMap.get(provider) || {
      provider, accountCount: 0, emailsSent: 0, contacted: 0, replied: 0, bounced: 0, interested: 0,
    };
    prov.accountCount++;
    prov.emailsSent += s.emails_sent_count;
    prov.contacted += s.total_leads_contacted_count;
    prov.replied += s.unique_replied_count;
    prov.bounced += s.bounced_count;
    prov.interested += s.interested_leads_count;
    providerMap.set(provider, prov);

    // Domain aggregation
    const dom = domainMap.get(domain) || {
      domain, provider, accountCount: 0, emailsSent: 0, contacted: 0, replied: 0, bounced: 0, interested: 0,
    };
    dom.accountCount++;
    dom.emailsSent += s.emails_sent_count;
    dom.contacted += s.total_leads_contacted_count;
    dom.replied += s.unique_replied_count;
    dom.bounced += s.bounced_count;
    dom.interested += s.interested_leads_count;
    domainMap.set(domain, dom);
  }

  const byProvider: ProviderStats[] = Array.from(providerMap.values())
    .map(p => ({
      ...p,
      replyRate: rate(p.replied, p.contacted),
      bounceRate: rate(p.bounced, p.emailsSent),
      interestRate: rate(p.interested, p.contacted),
    }))
    .sort((a, b) => b.emailsSent - a.emailsSent);

  const byDomain: DomainStats[] = Array.from(domainMap.values())
    .map(d => ({
      ...d,
      replyRate: rate(d.replied, d.contacted),
      bounceRate: rate(d.bounced, d.emailsSent),
      interestRate: rate(d.interested, d.contacted),
    }))
    .sort((a, b) => b.emailsSent - a.emailsSent);

  const topSenders: TopSender[] = senders
    .filter(s => s.emails_sent_count > 0)
    .sort((a, b) => b.emails_sent_count - a.emails_sent_count)
    .slice(0, 20)
    .map(s => ({
      email: s.email,
      domain: s.email.split('@')[1] || 'unknown',
      provider: detectProvider(s),
      status: s.status,
      emailsSent: s.emails_sent_count,
      replied: s.unique_replied_count,
      bounced: s.bounced_count,
      interested: s.interested_leads_count,
      replyRate: rate(s.unique_replied_count, s.total_leads_contacted_count),
      bounceRate: rate(s.bounced_count, s.emails_sent_count),
    }));

  return {
    totalAccounts: senders.length,
    connectedAccounts: connectedCount,
    byProvider,
    byDomain,
    topSenders,
  };
}

export async function GET(request: Request) {
  try {
    await switchWorkspace(SELERY_WORKSPACE_ID).catch(() => {});

    const url = new URL(request.url);
    const cycleParam = url.searchParams.get('cycle');

    // If cycle specified, aggregate from per-campaign sender data
    if (cycleParam) {
      const cycleFilter = parseInt(cycleParam, 10);
      const cycleRegex = new RegExp(`^Cycle\\s+${cycleFilter}\\b`, 'i');

      const campaigns = await getAllCampaigns();
      const cycleCampaigns = campaigns.filter(c => cycleRegex.test(c.name) && c.emails_sent > 0);

      // Fetch per-campaign senders in parallel
      const campaignSenderResults = await Promise.all(
        cycleCampaigns.map(async (c) => {
          try {
            const { data } = await getCampaignSenderEmails(c.id);
            return data || [];
          } catch {
            return [];
          }
        })
      );

      // Merge senders across campaigns — same email may appear in multiple campaigns
      // Aggregate their stats (each campaign returns scoped stats for that sender)
      const senderAgg = new Map<string, SenderEmail>();
      for (const campaignSenders of campaignSenderResults) {
        for (const s of campaignSenders) {
          const existing = senderAgg.get(s.email);
          if (existing) {
            existing.emails_sent_count += s.emails_sent_count;
            existing.total_leads_contacted_count += s.total_leads_contacted_count;
            existing.unique_replied_count += s.unique_replied_count;
            existing.bounced_count += s.bounced_count;
            existing.interested_leads_count += s.interested_leads_count;
            existing.total_replied_count += s.total_replied_count;
            existing.total_opened_count += s.total_opened_count;
            existing.unique_opened_count += s.unique_opened_count;
            existing.unsubscribed_count += s.unsubscribed_count;
          } else {
            // Clone so we don't mutate the original
            senderAgg.set(s.email, { ...s });
          }
        }
      }

      const mergedSenders = Array.from(senderAgg.values());
      const result = buildAnalytics(mergedSenders);

      return NextResponse.json({ data: result }, {
        headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' },
      });
    }

    // No cycle filter — use global sender data (original behavior)
    const senders = await getAllSenderEmails();
    const result = buildAnalytics(senders);

    return NextResponse.json({ data: result }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[Analytics/Senders] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate sender analytics' },
      { status: 500 }
    );
  }
}
