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

    // If cycle specified, derive cycle-scoped sender stats
    // The per-campaign sender endpoint returns GLOBAL stats, not campaign-scoped.
    // So we: 1) get global senders for provider/domain detection,
    //        2) get which senders are in each cycle campaign,
    //        3) allocate each campaign's actual stats proportionally by provider.
    if (cycleParam) {
      const cycleFilter = parseInt(cycleParam, 10);
      const cycleRegex = new RegExp(`^Cycle\\s+${cycleFilter}\\b`, 'i');

      const [campaigns, globalSenders] = await Promise.all([
        getAllCampaigns(),
        getAllSenderEmails(),
      ]);
      const cycleCampaigns = campaigns.filter(c => cycleRegex.test(c.name));

      // Build global lookup: email → provider & domain
      const senderInfoMap = new Map<string, { provider: EmailProvider; domain: string; status: string }>();
      for (const s of globalSenders) {
        senderInfoMap.set(s.email, {
          provider: detectProvider(s),
          domain: s.email.split('@')[1] || 'unknown',
          status: s.status,
        });
      }

      // Fetch per-campaign sender EMAIL LISTS (just need to know which senders are assigned)
      const campaignSenderResults = await Promise.all(
        cycleCampaigns.map(async (c) => {
          try {
            const senders = await getCampaignSenderEmails(c.id);
            return { campaign: c, senderEmails: senders.map(s => s.email) };
          } catch {
            return { campaign: c, senderEmails: [] as string[] };
          }
        })
      );

      // For each campaign, figure out provider mix and allocate campaign stats proportionally
      const providerAgg = new Map<EmailProvider, Omit<ProviderStats, 'replyRate' | 'bounceRate' | 'interestRate'>>();
      const domainAgg = new Map<string, Omit<DomainStats, 'replyRate' | 'bounceRate' | 'interestRate'> & { provider: EmailProvider }>();
      const cycleSenderEmails = new Set<string>();

      for (const { campaign, senderEmails } of campaignSenderResults) {
        if (senderEmails.length === 0) continue;

        // Count senders per provider for this campaign
        const providerCounts = new Map<EmailProvider, number>();
        const domainCounts = new Map<string, { count: number; provider: EmailProvider }>();
        for (const email of senderEmails) {
          cycleSenderEmails.add(email);
          const info = senderInfoMap.get(email) || { provider: 'Other' as EmailProvider, domain: email.split('@')[1] || 'unknown', status: '' };
          providerCounts.set(info.provider, (providerCounts.get(info.provider) || 0) + 1);
          const domEntry = domainCounts.get(info.domain) || { count: 0, provider: info.provider };
          domEntry.count++;
          domainCounts.set(info.domain, domEntry);
        }

        const totalSenders = senderEmails.length;

        // Allocate campaign stats proportionally by provider
        for (const [provider, count] of providerCounts) {
          const share = count / totalSenders;
          const prov = providerAgg.get(provider) || {
            provider, accountCount: 0, emailsSent: 0, contacted: 0, replied: 0, bounced: 0, interested: 0,
          };
          prov.emailsSent += Math.round(campaign.emails_sent * share);
          prov.contacted += Math.round(campaign.total_leads_contacted * share);
          prov.replied += Math.round(campaign.unique_replies * share);
          prov.bounced += Math.round(campaign.bounced * share);
          prov.interested += Math.round(campaign.interested * share);
          providerAgg.set(provider, prov);
        }

        // Allocate campaign stats proportionally by domain
        for (const [domain, { count, provider }] of domainCounts) {
          const share = count / totalSenders;
          const dom = domainAgg.get(domain) || {
            domain, provider, accountCount: 0, emailsSent: 0, contacted: 0, replied: 0, bounced: 0, interested: 0,
          };
          dom.emailsSent += Math.round(campaign.emails_sent * share);
          dom.contacted += Math.round(campaign.total_leads_contacted * share);
          dom.replied += Math.round(campaign.unique_replies * share);
          dom.bounced += Math.round(campaign.bounced * share);
          dom.interested += Math.round(campaign.interested * share);
          domainAgg.set(domain, dom);
        }
      }

      // Set accurate account counts from the unique sender emails in this cycle
      for (const email of cycleSenderEmails) {
        const info = senderInfoMap.get(email);
        if (!info) continue;
        const prov = providerAgg.get(info.provider);
        if (prov) prov.accountCount++;
        const dom = domainAgg.get(info.domain);
        if (dom) dom.accountCount++;
      }

      let connectedCount = 0;
      for (const email of cycleSenderEmails) {
        const info = senderInfoMap.get(email);
        if (info?.status?.toLowerCase() === 'connected') connectedCount++;
      }

      const byProvider: ProviderStats[] = Array.from(providerAgg.values())
        .map(p => ({
          ...p,
          replyRate: rate(p.replied, p.contacted),
          bounceRate: rate(p.bounced, p.emailsSent),
          interestRate: rate(p.interested, p.contacted),
        }))
        .sort((a, b) => b.emailsSent - a.emailsSent);

      const byDomain: DomainStats[] = Array.from(domainAgg.values())
        .map(d => ({
          ...d,
          replyRate: rate(d.replied, d.contacted),
          bounceRate: rate(d.bounced, d.emailsSent),
          interestRate: rate(d.interested, d.contacted),
        }))
        .sort((a, b) => b.emailsSent - a.emailsSent);

      const result: SenderAnalytics = {
        totalAccounts: cycleSenderEmails.size,
        connectedAccounts: connectedCount,
        byProvider,
        byDomain,
        topSenders: [], // Top individual senders not available at cycle scope
      };

      console.log(`[Analytics/Senders] Cycle ${cycleFilter}: ${cycleCampaigns.length} campaigns, ${cycleSenderEmails.size} unique senders, providers: ${byProvider.map(p => `${p.provider}(${p.accountCount})`).join(', ')}`);

      return NextResponse.json({ data: result }, {
        headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' },
      });
    }

    // No cycle filter — use global sender data (original behavior)
    const senders = await getAllSenderEmails();
    console.log(`[Analytics/Senders] Overall: ${senders.length} total senders, types: ${[...new Set(senders.map(s => s.type))].join(', ')}`);
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
