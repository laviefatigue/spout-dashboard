import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AnalyzedReply,
  AnalyticsReport,
  DemographicDistribution,
  ReplySentiment,
  ReplyIntent,
  SeniorityLevel,
} from '@/lib/types/emailbison';

const EMAILBISON_API_URL = process.env.EMAILBISON_API_URL || 'https://spellcast.hirecharm.com';
const EMAILBISON_API_TOKEN = process.env.EMAILBISON_API_TOKEN || '';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';

const SELERY_WORKSPACE_ID = 22;

interface EBReply {
  id: number;
  subject: string;
  from_email_address: string;
  from_name: string;
  text_body: string;
  html_body: string;
  interested: boolean;
  automated_reply: boolean;
  folder: string;
  campaign_id: number | null;
  lead_id: number | null;
  date_received: string;
}

interface EBLead {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  custom_variables: Array<{ name: string; value: string | null }>;
}

interface EBCampaign {
  id: number;
  name: string;
  status: string;
  emails_sent: number;
  interested: number;
  unique_replies: number;
  total_leads_contacted: number;
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${EMAILBISON_API_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${EMAILBISON_API_TOKEN}`,
      'Accept': 'application/json',
    },
  });
  if (!response.ok) throw new Error(`API error: ${response.status} ${endpoint}`);
  return response.json();
}

async function postApi<T>(endpoint: string, body: object): Promise<T> {
  const response = await fetch(`${EMAILBISON_API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${EMAILBISON_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`API error: ${response.status} ${endpoint}`);
  return response.json();
}

function classifySeniority(title: string | null): SeniorityLevel {
  if (!title) return 'Unknown';
  const t = title.toLowerCase();
  if (/\b(ceo|coo|cfo|cto|cmo|chief|co-founder|cofounder|founder|owner|president)\b/.test(t)) return 'C-Suite';
  if (/\b(vp|vice president|svp|evp)\b/.test(t)) return 'VP';
  if (/\b(director|head of)\b/.test(t)) return 'Director';
  if (/\b(manager|supervisor|lead|coordinator)\b/.test(t)) return 'Manager';
  if (/\b(specialist|analyst|associate|assistant|representative|intern)\b/.test(t)) return 'Individual Contributor';
  return 'Unknown';
}

function extractIndustryFromCampaign(campaignName: string): string {
  const lower = campaignName.toLowerCase();
  if (lower.includes('apparel')) return 'Apparel';
  if (lower.includes('dtc') || lower.includes('d2c')) return 'DTC / E-commerce';
  if (lower.includes('supplement')) return 'Supplements';
  if (lower.includes('beauty') || lower.includes('cosmetic')) return 'Beauty';
  if (lower.includes('footwear') || lower.includes('shoe')) return 'Footwear';
  if (lower.includes('food') || lower.includes('beverage')) return 'Food & Beverage';
  if (lower.includes('health') || lower.includes('wellness')) return 'Health & Wellness';
  if (lower.includes('pet')) return 'Pet Products';
  if (lower.includes('home') || lower.includes('housewares')) return 'Home Goods';
  if (lower.includes('electronics') || lower.includes('tech')) return 'Electronics';
  return 'Other';
}

function extractIndustryFromLead(lead: EBLead | null, campaignName: string): string {
  if (lead?.custom_variables?.length) {
    const industryVar = lead.custom_variables.find(v =>
      ['category', 'industry', 'vertical', 'segment', 'niche'].includes(v.name.toLowerCase())
    );
    if (industryVar?.value) return industryVar.value;
  }
  return extractIndustryFromCampaign(campaignName);
}

function cleanReplyText(textBody: string, htmlBody: string): string {
  let text = textBody || '';
  if (!text && htmlBody) {
    text = htmlBody
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }
  // Remove quoted reply chains
  const lines = text.split('\n');
  const cleanLines: string[] = [];
  for (const line of lines) {
    if (line.trim().startsWith('>')) break;
    if (/^On .+ wrote:/.test(line.trim())) break;
    if (/^-{3,}/.test(line.trim())) break;
    if (/^Sent from my/.test(line.trim())) break;
    cleanLines.push(line);
  }
  return cleanLines.join('\n').trim().substring(0, 1000);
}

interface AIClassification {
  sentiment: ReplySentiment;
  intent: ReplyIntent;
  themes: string[];
  buying_signals: string[];
  objections: string[];
  summary: string;
}

// ── AI Classification with Selery context ──────────────────────────────
async function classifyRepliesWithAI(
  replies: Array<{ id: number; text: string; from: string; subject: string; interested: boolean }>
): Promise<Map<number, AIClassification>> {
  const results = new Map<number, AIClassification>();

  if (!ANTHROPIC_API_KEY) {
    console.warn('[Analytics] No ANTHROPIC_API_KEY — falling back to rule-based classification');
    for (const reply of replies) {
      results.set(reply.id, ruleBasedClassification(reply.text));
    }
    return results;
  }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // Fire ALL batches in parallel (batches of 25 for headroom)
  const batchSize = 25;
  const batches: Array<Array<{ id: number; text: string; from: string; subject: string; interested: boolean }>> = [];
  for (let i = 0; i < replies.length; i += batchSize) {
    batches.push(replies.slice(i, i + batchSize));
  }

  const batchPromises = batches.map(async (batch, batchIdx) => {
    const replyList = batch.map((r, idx) =>
      `[REPLY ${idx + 1}] (ID: ${r.id})${r.interested ? ' [FLAGGED AS INTERESTED BY PLATFORM]' : ''}\nFrom: ${r.from}\nSubject: ${r.subject}\nBody: ${r.text}\n---`
    ).join('\n');

    try {
      const response = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: `You are classifying replies to cold outbound emails sent by **Selery Fulfillment**, a 3PL (third-party logistics) company that handles warehousing, fulfillment, and shipping for e-commerce brands. The emails pitch Selery's fulfillment services to e-commerce brand owners and operators.

Classify each reply below. For each, return:
- **sentiment**: "positive" | "negative" | "neutral"
- **intent**: "interested" | "not-interested" | "needs-info" | "referral" | "out-of-office" | "unsubscribe"
- **themes**: 1-3 short keywords
- **buying_signals**: concrete positive indicators (empty array if none)
- **objections**: concrete resistance points (empty array if none)
- **summary**: one sentence summary

### CLASSIFICATION RULES (follow strictly):

**POSITIVE / INTERESTED** — The person explicitly expresses interest in Selery's services or wants to continue the conversation:
  - "Yes, let's set up a call"
  - "We're currently looking for a new 3PL"
  - "Can you send me a quote?"
  - "What are your rates?"

**NEGATIVE / NOT-INTERESTED** — The person declines, is a bad fit, or pushes back. This includes:
  - "We're not interested"
  - "We handle fulfillment in-house"
  - "We have no inventory, we're a licensing company" → NEGATIVE (they don't need 3PL)
  - "We already have a 3PL we're happy with"
  - "Not a fit for us"
  - "We don't sell physical products"
  - "We're too small / too large for this"
  - Any reply that makes clear they can't or won't use fulfillment services

**NEUTRAL** — Purely informational, forwarding, or ambiguous with no clear signal either way

**QUESTIONS ABOUT THE SERVICE** — If someone asks a question about fulfillment, shipping, pricing, capabilities, etc., that means they're engaged. Classify as POSITIVE/INTERESTED with intent "needs-info":
  - "What locations do you ship from?" → POSITIVE
  - "Do you handle international?" → POSITIVE
  - "Can you send me a quote?" → POSITIVE

**UNSUBSCRIBE** — Explicitly asks to be removed from the list

**OUT-OF-OFFICE** — Automated away message

**REFERRAL** — Forwards to another person or says "talk to X instead"

### IMPORTANT:
- Some replies are tagged [FLAGGED AS INTERESTED BY PLATFORM]. These have been manually verified as interested. For these, sentiment MUST be "positive" and intent MUST be "interested". Still provide accurate themes, buying_signals, and summary.
- Do NOT mark someone as "positive" just because they replied. Many replies are rejections.
- If someone says they don't have inventory, don't sell physical products, are a licensing/IP company, or otherwise can't use fulfillment → that is NEGATIVE/NOT-INTERESTED.
- "Call" or "connect" alone does NOT mean interested — look at full context.
- Short rude replies like "Not interested" or "Remove me" are NEGATIVE.
- Someone mentioning "I will be OOO on [date]" as a scheduling note is NOT an out-of-office auto-reply — classify based on the actual content of their message.

${replyList}

Return ONLY a valid JSON array of objects with "id" and the classification fields. No markdown, no explanation.`
        }],
      });

      const content = response.content[0];
      if (content.type === 'text') {
        let jsonText = content.text.trim();
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        try {
          const classifications: Array<{ id: number } & AIClassification> = JSON.parse(jsonText);
          for (const c of classifications) {
            results.set(c.id, {
              sentiment: c.sentiment || 'neutral',
              intent: c.intent || 'not-interested',
              themes: c.themes || [],
              buying_signals: c.buying_signals || [],
              objections: c.objections || [],
              summary: c.summary || '',
            });
          }
        } catch (parseErr) {
          console.error(`[Analytics] JSON parse error in AI batch ${batchIdx}:`, parseErr, '\nRaw:', content.text.substring(0, 500));
          for (const reply of batch) {
            results.set(reply.id, ruleBasedClassification(reply.text));
          }
        }
      }
    } catch (apiErr) {
      console.error(`[Analytics] Anthropic API error in batch ${batchIdx}:`, apiErr);
      for (const reply of batch) {
        results.set(reply.id, ruleBasedClassification(reply.text));
      }
    }
  });

  await Promise.all(batchPromises);
  return results;
}

// ── Tightened rule-based fallback ──────────────────────────────────────
function ruleBasedClassification(text: string): AIClassification {
  const lower = text.toLowerCase();

  let sentiment: ReplySentiment = 'neutral';
  let intent: ReplyIntent = 'not-interested'; // Default to not-interested, not needs-info
  const themes: string[] = [];
  const buyingSignals: string[] = [];
  const objections: string[] = [];

  // OOO — only match actual auto-reply patterns, NOT casual mentions like "I will be OOO on Tuesday"
  if (/^.{0,30}(out of office|I.?m OOO|I am OOO)|auto.?reply|automatic reply|currently out of the office/i.test(lower)) {
    return {
      sentiment: 'neutral', intent: 'out-of-office',
      themes: ['out of office'], buying_signals: [], objections: [],
      summary: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    };
  }

  // Unsubscribe
  if (/unsubscribe|remove me|stop emailing|opt out|take me off/i.test(lower)) {
    return {
      sentiment: 'negative', intent: 'unsubscribe',
      themes: ['unsubscribe'], buying_signals: [], objections: [],
      summary: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
    };
  }

  // Clear negatives — check BEFORE positives
  if (/not interested|no thanks|no thank you|pass on this|not a fit|not looking|no need|don.?t need|we.?re good|we.?re all set/i.test(lower)) {
    sentiment = 'negative';
    intent = 'not-interested';
    themes.push('declined');
  } else if (/no inventory|licensing company|don.?t sell physical|don.?t ship|no physical product|we.?re a .*(licensing|software|saas|media|ip) company/i.test(lower)) {
    sentiment = 'negative';
    intent = 'not-interested';
    themes.push('not applicable');
    objections.push('no physical products');
  } else if (/already have a (3pl|fulfillment|warehouse)|happy with our (3pl|fulfillment|warehouse)|current (3pl|fulfillment|warehouse)/i.test(lower)) {
    sentiment = 'negative';
    intent = 'not-interested';
    themes.push('existing vendor');
    objections.push('existing 3PL');
  } else if (/handle.*(in.?house|ourselves|internally)|do our own (fulfillment|shipping|warehouse)/i.test(lower)) {
    sentiment = 'negative';
    intent = 'not-interested';
    themes.push('in-house fulfillment');
    objections.push('handles in-house');
  } else if (/forward|reach out to|contact .+ instead|the right person|refer/i.test(lower)) {
    sentiment = 'neutral';
    intent = 'referral';
    themes.push('referral');
  } else if (/\b(pricing|cost|rate|quote|proposal)\b/i.test(lower) && /\?|\bwhat\b|\bhow much\b|\bsend\b/i.test(lower)) {
    // Pricing questions = buying signal = positive
    sentiment = 'positive';
    intent = 'interested';
    themes.push('pricing inquiry');
    buyingSignals.push('asked about pricing');
  } else if (/\b(yes|absolutely|definitely|love to|would like to|let.?s (set up|schedule|talk|connect|chat))\b/i.test(lower)) {
    // Strong positive signals only — NOT just "call" or "connect" alone
    sentiment = 'positive';
    intent = 'interested';
    if (/schedule|call|meet|time|next week/i.test(lower)) buyingSignals.push('wants to meet');
    themes.push('interested');
  } else if (/sounds good|tell me more|send me (more )?info|interested in learning/i.test(lower)) {
    sentiment = 'positive';
    intent = 'needs-info';
    themes.push('wants info');
  } else if (/\?/.test(text) && text.split('?').length > 1) {
    // Questions about the service = interested
    sentiment = 'positive';
    intent = 'interested';
    themes.push('question about service');
  }

  // Objections (can co-exist with any classification)
  if (/contract|locked in|committed/i.test(lower)) objections.push('under contract');
  if (/budget|afford|expensive/i.test(lower)) objections.push('budget concerns');
  if (/timing|not now|later|next quarter|not ready/i.test(lower)) objections.push('timing');
  if (/too small|just starting|startup/i.test(lower)) objections.push('too small');

  return {
    sentiment,
    intent,
    themes: themes.length ? themes : ['general'],
    buying_signals: buyingSignals,
    objections,
    summary: text.substring(0, 100) + (text.length > 100 ? '...' : ''),
  };
}

function buildDistribution(items: string[]): DemographicDistribution[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item, (counts.get(item) || 0) + 1);
  }
  const total = items.length;
  return Array.from(counts.entries())
    .map(([label, count]) => ({
      label,
      count,
      percentage: total > 0 ? parseFloat(((count / total) * 100).toFixed(1)) : 0,
      interestedCount: 0,
    }))
    .sort((a, b) => b.count - a.count);
}

// ── Parallel fetch helpers ─────────────────────────────────────────────

/** Fetch page 1 to get meta, then fetch remaining pages in parallel */
async function fetchAllReplies(): Promise<EBReply[]> {
  const page1 = await fetchApi<{
    data: EBReply[];
    meta?: { last_page: number; current_page: number };
  }>('/api/replies?folder=inbox&page=1');

  const allReplies = [...(page1.data || [])];
  const lastPage = page1.meta?.last_page || 1;

  if (lastPage > 1) {
    const pageNums = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
    const pageResults = await Promise.all(
      pageNums.map(async (p) => {
        try {
          const res = await fetchApi<{ data: EBReply[] }>(`/api/replies?folder=inbox&page=${p}`);
          return res.data || [];
        } catch (err) {
          console.error(`[Analytics] Failed to fetch replies page ${p}:`, err);
          return [];
        }
      })
    );
    for (const pageData of pageResults) {
      allReplies.push(...pageData);
    }
  }

  return allReplies;
}

/** Fetch all lead details in parallel (cap at 50 concurrent) */
async function fetchLeadDetails(leadIds: number[]): Promise<Map<number, EBLead>> {
  const map = new Map<number, EBLead>();
  const capped = leadIds.slice(0, 200);

  // All at once — EB API handles it fine at this volume
  const chunkSize = 50;
  for (let i = 0; i < capped.length; i += chunkSize) {
    const chunk = capped.slice(i, i + chunkSize);
    const results = await Promise.all(
      chunk.map(async (leadId) => {
        try {
          const response = await fetchApi<{ data: EBLead }>(`/api/leads/${leadId}`);
          return response.data ? { id: leadId, lead: response.data } : null;
        } catch {
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) map.set(r.id, r.lead);
    }
  }

  return map;
}

// ── Main route ─────────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');
    const targetWorkspaceId = workspaceId ? parseInt(workspaceId) : SELERY_WORKSPACE_ID;

    // Switch workspace
    try {
      await postApi<unknown>('/api/workspaces/switch-workspace', {
        team_id: targetWorkspaceId,
      });
    } catch {
      // Continue with current workspace
    }

    // Fetch workspace name + campaigns + replies in parallel
    type UserData = { data: { workspace?: { name: string }; team?: { name: string } } };
    const [userResult, campaignsResult, allReplies] = await Promise.all([
      fetchApi<UserData>('/api/users')
        .catch((): UserData => ({ data: { workspace: { name: 'Selery' } } })),
      fetchApi<{ data: EBCampaign[] }>('/api/campaigns'),
      fetchAllReplies(),
    ]);

    const workspaceName = userResult.data.workspace?.name || userResult.data.team?.name || 'Selery';
    const campaigns = campaignsResult.data;
    const activeCampaigns = campaigns.filter(c => c.emails_sent > 0);
    const campaignMap = new Map(campaigns.map(c => [c.id, c]));

    // Filter to replies from active campaigns only
    const campaignIds = new Set(activeCampaigns.map(c => c.id));
    const campaignReplies = allReplies.filter(r => r.campaign_id && campaignIds.has(r.campaign_id));

    // ── FIX 1A: Filter out automated junk BEFORE classification ──
    // Only human replies get classified. Automated OOO/bounces are excluded from everything.
    const humanReplies = campaignReplies.filter(r => !r.automated_reply || r.interested);

    // Fetch lead details for human replies only (parallel)
    const leadIds = [...new Set(humanReplies.map(r => r.lead_id).filter((id): id is number => id !== null))];
    const leadDetailsMap = await fetchLeadDetails(leadIds);

    // Prepare replies for AI classification
    const repliesForAnalysis = humanReplies
      .slice(0, 200)
      .map(r => ({
        id: r.id,
        text: cleanReplyText(r.text_body, r.html_body),
        from: r.from_name,
        subject: r.subject,
        interested: r.interested,
      }));

    // Run AI classification (all batches in parallel internally)
    const classifications = await classifyRepliesWithAI(repliesForAnalysis);

    // Build analyzed replies — ONLY from human replies
    const analyzedReplies: AnalyzedReply[] = [];

    for (const reply of humanReplies) {
      const campaign = reply.campaign_id ? campaignMap.get(reply.campaign_id) : null;
      const lead = reply.lead_id ? leadDetailsMap.get(reply.lead_id) : null;
      const campaignName = campaign?.name || 'Unknown Campaign';

      const classification = classifications.get(reply.id) || ruleBasedClassification(
        cleanReplyText(reply.text_body, reply.html_body)
      );

      // Hard override: if EmailBison flagged as interested, trust it
      if (reply.interested) {
        classification.sentiment = 'positive';
        classification.intent = 'interested';
        if (!classification.buying_signals.length) {
          classification.buying_signals = ['flagged interested in EmailBison'];
        }
      }

      const company = lead?.company || (() => {
        const domain = reply.from_email_address.split('@')[1] || '';
        return domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
      })();

      analyzedReplies.push({
        replyId: reply.id,
        leadId: reply.lead_id,
        email: reply.from_email_address,
        name: lead ? `${lead.first_name} ${lead.last_name}`.trim() : reply.from_name,
        company,
        title: lead?.title || '',
        seniority: classifySeniority(lead?.title || null),
        industry: extractIndustryFromLead(lead || null, campaignName),
        campaignId: reply.campaign_id || 0,
        campaignName: campaignName.split(':').pop()?.trim() || campaignName,
        subject: reply.subject.replace(/^Re:\s*/i, '').replace(/^\[External\]\s*/i, '').trim(),
        replyText: cleanReplyText(reply.text_body, reply.html_body),
        replyDate: reply.date_received,
        isInterested: reply.interested,
        isAutomated: reply.automated_reply,
        sentiment: classification.sentiment,
        intent: classification.intent,
        themes: classification.themes,
        buyingSignals: classification.buying_signals,
        objections: classification.objections,
        summary: classification.summary,
      });
    }

    // Sort by date (most recent first)
    analyzedReplies.sort((a, b) => new Date(b.replyDate).getTime() - new Date(a.replyDate).getTime());

    // Build sentiment/intent breakdown — all from human replies only
    const sentimentBreakdown: Record<ReplySentiment, number> = { positive: 0, negative: 0, neutral: 0 };
    const intentBreakdown: Record<ReplyIntent, number> = {
      'interested': 0, 'not-interested': 0, 'needs-info': 0,
      'referral': 0, 'out-of-office': 0, 'unsubscribe': 0,
    };

    for (const r of analyzedReplies) {
      sentimentBreakdown[r.sentiment]++;
      intentBreakdown[r.intent]++;
    }

    // Demographics
    const industries = analyzedReplies.map(r => r.industry);
    const seniorities = analyzedReplies.map(r => r.seniority);
    const companies = analyzedReplies.map(r => r.company);

    const industryDist = buildDistribution(industries);
    const seniorityDist = buildDistribution(seniorities);
    const companyDist = buildDistribution(companies).slice(0, 15);

    // Enrich with interested counts
    for (const dist of industryDist) {
      dist.interestedCount = analyzedReplies.filter(r => r.industry === dist.label && r.isInterested).length;
    }
    for (const dist of seniorityDist) {
      dist.interestedCount = analyzedReplies.filter(r => r.seniority === dist.label && r.isInterested).length;
    }
    for (const dist of companyDist) {
      dist.interestedCount = analyzedReplies.filter(r => r.company === dist.label && r.isInterested).length;
    }

    // Aggregate themes, objections, buying signals
    const themeCount = new Map<string, number>();
    const objectionCount = new Map<string, number>();
    const signalCount = new Map<string, number>();

    for (const r of analyzedReplies) {
      for (const t of r.themes) {
        themeCount.set(t, (themeCount.get(t) || 0) + 1);
      }
      for (const o of r.objections) {
        objectionCount.set(o, (objectionCount.get(o) || 0) + 1);
      }
      for (const s of r.buyingSignals) {
        signalCount.set(s, (signalCount.get(s) || 0) + 1);
      }
    }

    const report: AnalyticsReport = {
      workspaceName,
      totalReplies: allReplies.length,
      totalAnalyzed: analyzedReplies.length,
      sentimentBreakdown,
      intentBreakdown,
      industryDistribution: industryDist,
      seniorityDistribution: seniorityDist,
      topCompanies: companyDist,
      topThemes: Array.from(themeCount.entries())
        .map(([theme, count]) => ({ theme, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topObjections: Array.from(objectionCount.entries())
        .map(([objection, count]) => ({ objection, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      topBuyingSignals: Array.from(signalCount.entries())
        .map(([signal, count]) => ({ signal, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      replies: analyzedReplies,
      campaigns: activeCampaigns.map(c => ({ id: c.id, name: c.name })),
      industries: [...new Set(industries)].sort(),
    };

    return NextResponse.json({ data: report }, {
      headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=300' },
    });
  } catch (error) {
    console.error('[Analytics] Fatal error:', error);
    return NextResponse.json(
      { error: 'Failed to generate analytics' },
      { status: 500 }
    );
  }
}
