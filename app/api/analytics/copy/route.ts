import { NextResponse } from 'next/server';
import { getAllCampaigns, getCampaignStats, getCampaignSequenceSteps, switchWorkspace } from '@/lib/api/emailbison';
import type {
  Campaign,
  CopyAnalysis,
  AggregatedCopyVariant,
  SubjectType,
  OpenerType,
  CTAType,
} from '@/lib/types/emailbison';

const SELERY_WORKSPACE_ID = 22;

interface CampaignWithSubject {
  campaign: Campaign;
  subjectLine: string;
  interestRate: number;
  replyRate: number;
}

// ── Text extraction helpers ──────────────────────────────────────────

function cleanBodyText(htmlBody: string): string {
  return htmlBody
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}|]+\|[^}]+\}/g, (match) => match.split('|')[0].replace('{', ''))
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOpeningHook(htmlBody: string): string {
  const text = cleanBodyText(htmlBody);
  const firstSentence = text.split(/[.!?]/)[0]?.trim() || '';
  return firstSentence.length > 120 ? firstSentence.substring(0, 120) + '...' : firstSentence;
}

function extractCTA(htmlBody: string): string {
  const text = cleanBodyText(htmlBody);
  const sentences = text.split(/(?<=[.!?])\s+/);
  const questions = sentences.filter(s => s.includes('?'));
  if (questions.length > 0) {
    return questions[questions.length - 1].trim();
  }
  const lastSentence = sentences[sentences.length - 1]?.trim() || '';
  return lastSentence.length > 120 ? lastSentence.substring(0, 120) + '...' : lastSentence;
}

// ── Categorization helpers ───────────────────────────────────────────

function categorizeSubject(subject: string): SubjectType[] {
  const lower = subject.toLowerCase();
  const types: SubjectType[] = [];

  if (subject.includes('?')) types.push('question');
  if (lower.includes('{{') || lower.includes('first_name') || lower.includes('company')) types.push('personalized');
  if (lower.match(/free|save|increase|boost|grow|improve|x\s*roi|%/)) types.push('benefit');
  if (lower.match(/struggling|problem|issue|pain|frustrated|tired of/)) types.push('pain');
  if (lower.match(/this|quick|idea|thought|re:|fwd:/i)) types.push('curiosity');
  if (types.length === 0) types.push('direct');

  return types;
}

function categorizeOpener(text: string): OpenerType[] {
  const lower = text.toLowerCase();
  const types: OpenerType[] = [];

  if (lower.includes('first_name') || lower.includes('{{') || lower.match(/^(hey|hi)\s+\w+/)) {
    types.push('personalized');
  }
  if (lower.match(/^(struggling|frustrated|tired|sick of|dealing with|if you're|most |many )/)) {
    types.push('pain-first');
  }
  if (lower.match(/^(we |our |i |just |recently |we've |i've ).*?(help|save|increase|grow|boost)/)) {
    types.push('benefit-first');
  }
  if (text.split(/[.!]/)[0]?.includes('?')) {
    types.push('question');
  }
  if (lower.match(/^(want|would you|can i|let me|i'd like to)/)) {
    types.push('direct-offer');
  }
  if (lower.match(/(we just|we recently|one of our|a client|a company|working with)/)) {
    types.push('story');
  }
  if (lower.match(/(\d+%|\d+x|roi|companies|clients|results)/)) {
    types.push('social-proof');
  }
  if (types.length === 0) types.push('direct-offer');
  return types;
}

function categorizeCTA(text: string): { type: CTAType; commitment: 'low' | 'medium' | 'high' } {
  const lower = text.toLowerCase();

  if (lower.match(/send you|free|sample|try|unit|test|complimentary/)) {
    return { type: 'free-offer', commitment: 'low' };
  }
  if (lower.match(/^(want|interested|would you|open to|curious)/i) && text.includes('?')) {
    return { type: 'soft-question', commitment: 'low' };
  }
  if (lower.match(/learn more|more info|details|send.*info/)) {
    return { type: 'info-request', commitment: 'medium' };
  }
  if (lower.match(/demo|show you|walk.*through/)) {
    return { type: 'demo', commitment: 'medium' };
  }
  if (lower.match(/call|chat|meeting|schedule|book|15 min|30 min|time/)) {
    return { type: 'meeting-request', commitment: 'high' };
  }
  if (lower.match(/today|now|asap|this week|limited/)) {
    return { type: 'urgent', commitment: 'high' };
  }
  return { type: 'soft-question', commitment: 'medium' };
}

// ── Redundancy detection ─────────────────────────────────────────────

function findRedundantSubjects(subjects: Array<{ subject: string; interestRate: number }>): string[] {
  const redundant: string[] = [];
  const normalized = subjects.map(s => ({
    ...s,
    normalized: s.subject.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).sort().join(' ')
  }));

  const seen = new Map<string, number>();
  for (const s of normalized) {
    const key = s.normalized.substring(0, 30);
    if (seen.has(key)) {
      redundant.push(`"${s.subject}" similar to previous`);
    } else {
      seen.set(key, s.interestRate);
    }
  }
  return redundant;
}

// ── Body pattern analysis ────────────────────────────────────────────

function analyzeBodyPatterns(sequences: Array<{
  body: string; interestRate: number; campaign: string;
  leadsContacted?: number; interested?: number; replies?: number; sent?: number;
}>) {
  const sorted = [...sequences].sort((a, b) => b.interestRate - a.interestRate);
  const midpoint = Math.ceil(sorted.length / 2);
  const top = sorted.slice(0, Math.max(3, midpoint));
  const bottom = sorted.slice(-Math.max(3, midpoint));

  // Aggregate hooks across campaigns
  const hookMap = new Map<string, typeof sequences>();
  for (const s of sequences) {
    const hook = extractOpeningHook(s.body);
    const key = hook.toLowerCase().substring(0, 50);
    if (hook.length < 10) continue;
    if (!hookMap.has(key)) hookMap.set(key, []);
    hookMap.get(key)!.push(s);
  }

  const aggregatedHooks: AggregatedCopyVariant[] = [];
  for (const [, seqs] of hookMap) {
    const totalLeads = seqs.reduce((s, c) => s + (c.leadsContacted || 0), 0);
    const totalInterested = seqs.reduce((s, c) => s + (c.interested || 0), 0);
    const totalReplies = seqs.reduce((s, c) => s + (c.replies || 0), 0);
    const totalSent = seqs.reduce((s, c) => s + (c.sent || 0), 0);
    const avgInterest = totalLeads > 0
      ? (totalInterested / totalLeads) * 100
      : seqs.reduce((s, c) => s + c.interestRate, 0) / seqs.length;
    const openerTypes = categorizeOpener(cleanBodyText(seqs[0].body));

    aggregatedHooks.push({
      copy: extractOpeningHook(seqs[0].body),
      appearances: seqs.length,
      campaignNames: [...new Set(seqs.map(c => c.campaign))],
      totalSent,
      totalLeadsContacted: totalLeads,
      totalInterested,
      totalReplies,
      weightedInterestRate: parseFloat(avgInterest.toFixed(2)),
      weightedReplyRate: totalLeads > 0 ? parseFloat(((totalReplies / totalLeads) * 100).toFixed(2)) : 0,
      openerType: openerTypes[0],
    });
  }
  aggregatedHooks.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);

  const topHooks = top.map(s => extractOpeningHook(s.body)).filter(h => h.length > 10);
  const bottomHooks = bottom.map(s => extractOpeningHook(s.body)).filter(h => h.length > 10);

  const topOpenerTypes: Record<OpenerType, number> = {
    'pain-first': 0, 'benefit-first': 0, 'question': 0, 'story': 0,
    'direct-offer': 0, 'social-proof': 0, 'personalized': 0
  };
  const bottomOpenerTypes: Record<OpenerType, number> = { ...topOpenerTypes };

  for (const s of top) {
    categorizeOpener(cleanBodyText(s.body)).forEach(t => topOpenerTypes[t]++);
  }
  for (const s of bottom) {
    categorizeOpener(cleanBodyText(s.body)).forEach(t => bottomOpenerTypes[t]++);
  }

  const topSorted = Object.entries(topOpenerTypes).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomOpenerTypes).sort((a, b) => b[1] - a[1]);
  const winningType = topSorted[0]?.[0] || 'direct-offer';
  const losingType = bottomSorted[0]?.[0] || 'direct-offer';

  let contrast = '';
  let winningApproach = '';
  let failingApproach = '';

  const topPersonalized = topOpenerTypes['personalized'];
  const bottomPersonalized = bottomOpenerTypes['personalized'];
  if (topPersonalized > bottomPersonalized + 1) {
    contrast = 'Personalized openers significantly outperform generic ones';
    winningApproach = `${topPersonalized}/${top.length} top performers use personalization`;
  } else if (bottomPersonalized > topPersonalized + 1) {
    contrast = 'Personalization alone isn\'t driving results - value prop matters more';
  }

  const topQuestions = topOpenerTypes['question'];
  const bottomQuestions = bottomOpenerTypes['question'];
  if (topQuestions > bottomQuestions + 1) {
    contrast = contrast || 'Question-based openers create curiosity and drive engagement';
    winningApproach = winningApproach || `Questions work: ${topQuestions}/${top.length} winners vs ${bottomQuestions}/${bottom.length} losers`;
  }

  if (topOpenerTypes['direct-offer'] > bottomOpenerTypes['direct-offer'] + 1) {
    contrast = contrast || 'Direct, clear value props outperform clever copy';
  } else if (bottomOpenerTypes['direct-offer'] > topOpenerTypes['direct-offer'] + 1) {
    failingApproach = `Direct pitches underperform: ${bottomOpenerTypes['direct-offer']}/${bottom.length} in low performers`;
  }

  if (topOpenerTypes['social-proof'] > bottomOpenerTypes['social-proof']) {
    winningApproach = winningApproach || 'Social proof elements (numbers, client mentions) boost credibility';
  }

  if (!contrast) {
    contrast = winningType === losingType
      ? `All campaigns use similar ${winningType.replace('-', ' ')} openers. Test different approaches: pain-first, question-based, or social proof.`
      : `${winningType.replace('-', ' ')} openers trending higher than ${losingType.replace('-', ' ')}`;
  }
  if (!winningApproach) {
    winningApproach = `Top approach: ${winningType.replace('-', ' ')} (${topSorted[0]?.[1] || 0}/${top.length} top campaigns)`;
  }
  if (!failingApproach) {
    failingApproach = winningType === losingType
      ? `No clear failing pattern - all campaigns use ${losingType.replace('-', ' ')} openers`
      : `Underperforming: ${losingType.replace('-', ' ')} heavy in bottom ${bottom.length} campaigns`;
  }

  return {
    aggregated: aggregatedHooks,
    topHooks,
    bottomHooks,
    keyPattern: contrast,
    analysis: {
      topOpenerTypes,
      bottomOpenerTypes,
      winningApproach,
      failingApproach,
      contrast,
    }
  };
}

// ── CTA pattern analysis ─────────────────────────────────────────────

function analyzeCTAPatterns(sequences: Array<{
  body: string; interestRate: number; campaign: string;
  leadsContacted?: number; interested?: number; replies?: number; sent?: number;
}>) {
  const sorted = [...sequences].sort((a, b) => b.interestRate - a.interestRate);
  const midpoint = Math.ceil(sorted.length / 2);
  const top = sorted.slice(0, Math.max(3, midpoint));
  const bottom = sorted.slice(-Math.max(3, midpoint));

  // Aggregate CTAs
  const ctaMap = new Map<string, typeof sequences>();
  for (const s of sequences) {
    const cta = extractCTA(s.body);
    const key = cta.toLowerCase().substring(0, 40);
    if (cta.length < 5) continue;
    if (!ctaMap.has(key)) ctaMap.set(key, []);
    ctaMap.get(key)!.push(s);
  }

  const aggregatedCTAs: AggregatedCopyVariant[] = [];
  for (const [, seqs] of ctaMap) {
    const totalLeads = seqs.reduce((s, c) => s + (c.leadsContacted || 0), 0);
    const totalInterested = seqs.reduce((s, c) => s + (c.interested || 0), 0);
    const totalReplies = seqs.reduce((s, c) => s + (c.replies || 0), 0);
    const totalSent = seqs.reduce((s, c) => s + (c.sent || 0), 0);
    const avgInterest = totalLeads > 0
      ? (totalInterested / totalLeads) * 100
      : seqs.reduce((s, c) => s + c.interestRate, 0) / seqs.length;
    const { type: ctaType } = categorizeCTA(extractCTA(seqs[0].body));

    aggregatedCTAs.push({
      copy: extractCTA(seqs[0].body),
      appearances: seqs.length,
      campaignNames: [...new Set(seqs.map(c => c.campaign))],
      totalSent,
      totalLeadsContacted: totalLeads,
      totalInterested,
      totalReplies,
      weightedInterestRate: parseFloat(avgInterest.toFixed(2)),
      weightedReplyRate: totalLeads > 0 ? parseFloat(((totalReplies / totalLeads) * 100).toFixed(2)) : 0,
      ctaType,
    });
  }
  aggregatedCTAs.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);

  const topCTAs = top.map(s => extractCTA(s.body)).filter(c => c.length > 5);
  const bottomCTAs = bottom.map(s => extractCTA(s.body)).filter(c => c.length > 5);

  const topCTATypes: Record<CTAType, number> = {
    'free-offer': 0, 'meeting-request': 0, 'soft-question': 0,
    'demo': 0, 'info-request': 0, 'urgent': 0
  };
  const bottomCTATypes: Record<CTAType, number> = { ...topCTATypes };

  let topLowCommit = 0, topHighCommit = 0;
  let bottomLowCommit = 0, bottomHighCommit = 0;

  for (const s of top) {
    const { type, commitment } = categorizeCTA(extractCTA(s.body));
    topCTATypes[type]++;
    if (commitment === 'low') topLowCommit++;
    if (commitment === 'high') topHighCommit++;
  }
  for (const s of bottom) {
    const { type, commitment } = categorizeCTA(extractCTA(s.body));
    bottomCTATypes[type]++;
    if (commitment === 'low') bottomLowCommit++;
    if (commitment === 'high') bottomHighCommit++;
  }

  const topSorted = Object.entries(topCTATypes).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomCTATypes).sort((a, b) => b[1] - a[1]);
  const winningCTAType = topSorted[0]?.[0] || 'soft-question';
  const failingCTAType = bottomSorted[0]?.[0] || 'meeting-request';

  let commitmentAnalysis: string;
  if (topLowCommit > topHighCommit && bottomHighCommit > bottomLowCommit) {
    commitmentAnalysis = `Low-commitment CTAs dominate winners (${topLowCommit}/${top.length}). High-commitment asks failing (${bottomHighCommit}/${bottom.length} in bottom).`;
  } else if (topHighCommit > topLowCommit) {
    commitmentAnalysis = `High-commitment CTAs working for this audience - they're ready to engage.`;
  } else {
    commitmentAnalysis = `Mixed commitment levels - test more low-friction asks like free samples/trials.`;
  }

  let keyPattern: string;
  if (topCTATypes['free-offer'] > bottomCTATypes['free-offer'] + 1) {
    keyPattern = 'Free offer/sample CTAs dramatically outperform meeting requests';
  } else if (topCTATypes['soft-question'] > bottomCTATypes['soft-question'] + 1) {
    keyPattern = 'Permission-based questions ("Want a...?") beat direct asks';
  } else if (bottomCTATypes['meeting-request'] > topCTATypes['meeting-request'] + 1) {
    keyPattern = 'Meeting/call requests underperforming - reduce friction with softer asks';
  } else if (winningCTAType === failingCTAType) {
    keyPattern = `All campaigns use ${winningCTAType} CTAs - test different approaches (demos, meetings, info requests) to find what converts better`;
  } else {
    keyPattern = `${winningCTAType.replace('-', ' ')} CTAs trending higher than ${failingCTAType.replace('-', ' ')}`;
  }

  return {
    aggregated: aggregatedCTAs,
    topCTAs,
    bottomCTAs,
    keyPattern,
    analysis: {
      topCTATypes,
      bottomCTATypes,
      commitmentAnalysis,
      winningCTAType: winningCTAType.replace('-', ' '),
      failingCTAType: failingCTAType.replace('-', ' '),
    }
  };
}

// ── Subject line analysis ────────────────────────────────────────────

function buildCopyAnalysis(campaignDetails: CampaignWithSubject[]): CopyAnalysis {
  const sorted = [...campaignDetails].sort((a, b) => b.interestRate - a.interestRate);
  const withInterest = sorted.filter(c => c.campaign.emails_sent >= 100);

  // Aggregate subjects
  const subjectMap = new Map<string, CampaignWithSubject[]>();
  for (const c of withInterest) {
    const key = c.subjectLine.toLowerCase().trim();
    if (!subjectMap.has(key)) subjectMap.set(key, []);
    subjectMap.get(key)!.push(c);
  }

  const aggregatedSubjects: AggregatedCopyVariant[] = [];
  for (const [, campaigns] of subjectMap) {
    const totalLeads = campaigns.reduce((s, c) => s + c.campaign.total_leads_contacted, 0);
    const totalInterested = campaigns.reduce((s, c) => s + c.campaign.interested, 0);
    const totalReplies = campaigns.reduce((s, c) => s + c.campaign.unique_replies, 0);
    const totalSent = campaigns.reduce((s, c) => s + c.campaign.emails_sent, 0);

    aggregatedSubjects.push({
      copy: campaigns[0].subjectLine,
      appearances: campaigns.length,
      campaignNames: [...new Set(campaigns.map(c => c.campaign.name.split(':')[0].split('-')[0].trim()))],
      totalSent,
      totalLeadsContacted: totalLeads,
      totalInterested,
      totalReplies,
      weightedInterestRate: totalLeads > 0 ? parseFloat(((totalInterested / totalLeads) * 100).toFixed(2)) : 0,
      weightedReplyRate: totalLeads > 0 ? parseFloat(((totalReplies / totalLeads) * 100).toFixed(2)) : 0,
      types: categorizeSubject(campaigns[0].subjectLine),
    });
  }
  aggregatedSubjects.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);

  // Legacy top/bottom performers
  const seenTop = new Set<string>();
  const topCampaigns = withInterest.filter(c => {
    const key = c.subjectLine.toLowerCase().trim();
    if (seenTop.has(key)) return false;
    seenTop.add(key);
    return true;
  }).slice(0, 5);

  const seenBottom = new Set<string>();
  const bottomCampaigns = [...withInterest].reverse().filter(c => {
    const key = c.subjectLine.toLowerCase().trim();
    if (seenBottom.has(key)) return false;
    seenBottom.add(key);
    return true;
  }).slice(0, 5);

  const topSubjects = topCampaigns.map(c => ({
    subject: c.subjectLine,
    campaign: c.campaign.name.split(':')[0].split('-')[0].trim(),
    interestRate: c.interestRate,
    replyRate: c.replyRate,
    sent: c.campaign.emails_sent,
    types: categorizeSubject(c.subjectLine),
  }));

  const bottomSubjects = bottomCampaigns.map(c => ({
    subject: c.subjectLine,
    campaign: c.campaign.name.split(':')[0].split('-')[0].trim(),
    interestRate: c.interestRate,
    replyRate: c.replyRate,
    sent: c.campaign.emails_sent,
    types: categorizeSubject(c.subjectLine),
  }));

  // Type breakdowns
  const topTypeBreakdown: Record<SubjectType, number> = {
    question: 0, benefit: 0, curiosity: 0, direct: 0, pain: 0, personalized: 0
  };
  const bottomTypeBreakdown: Record<SubjectType, number> = { ...topTypeBreakdown };
  topSubjects.forEach(s => s.types.forEach(t => topTypeBreakdown[t]++));
  bottomSubjects.forEach(s => s.types.forEach(t => bottomTypeBreakdown[t]++));

  const topSorted = Object.entries(topTypeBreakdown).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomTypeBreakdown).sort((a, b) => b[1] - a[1]);

  let winningPattern = '';
  let failingPattern = '';
  let keyInsight = '';

  if (topTypeBreakdown.question > bottomTypeBreakdown.question + 1) {
    winningPattern = `Question subjects dominate winners (${topTypeBreakdown.question}/${topSubjects.length})`;
  } else if (topTypeBreakdown.benefit > bottomTypeBreakdown.benefit + 1) {
    winningPattern = `Benefit-focused subjects drive interest (${topTypeBreakdown.benefit}/${topSubjects.length})`;
  } else if (topTypeBreakdown.curiosity > bottomTypeBreakdown.curiosity + 1) {
    winningPattern = `Curiosity-gap subjects outperform (${topTypeBreakdown.curiosity}/${topSubjects.length})`;
  } else {
    winningPattern = `Top pattern: ${topSorted[0]?.[0] || 'direct'} (${topSorted[0]?.[1] || 0}/${topSubjects.length})`;
  }

  if (bottomTypeBreakdown.direct > topTypeBreakdown.direct + 1) {
    failingPattern = `Generic direct subjects underperform (${bottomTypeBreakdown.direct}/${bottomSubjects.length})`;
  } else if (bottomTypeBreakdown.benefit > topTypeBreakdown.benefit + 1) {
    failingPattern = `Benefit claims not resonating - try specificity (${bottomTypeBreakdown.benefit}/${bottomSubjects.length})`;
  } else {
    failingPattern = `Bottom heavy with: ${bottomSorted[0]?.[0] || 'direct'} (${bottomSorted[0]?.[1] || 0}/${bottomSubjects.length})`;
  }

  const allSubjects = withInterest.map(c => ({ subject: c.subjectLine, interestRate: c.interestRate }));
  const redundancy = findRedundantSubjects(allSubjects);

  if (redundancy.length >= withInterest.length * 0.5) {
    keyInsight = `CRITICAL: ${redundancy.length + 1} campaigns use the same subject line. Cannot analyze patterns without variation - test diverse subject lines.`;
  } else if (topTypeBreakdown.personalized > bottomTypeBreakdown.personalized) {
    keyInsight = 'Personalization correlates with higher interest - use {{first_name}} and company variables';
  } else if (topTypeBreakdown.question > bottomTypeBreakdown.question) {
    keyInsight = 'Questions create engagement - test more subject lines ending with "?"';
  } else if (topTypeBreakdown.curiosity > bottomTypeBreakdown.curiosity) {
    keyInsight = 'Curiosity gaps work - "Quick thought" or "This" outperform explicit subjects';
  } else if (topSorted[0]?.[0] === bottomSorted[0]?.[0]) {
    keyInsight = `All campaigns use ${topSorted[0]?.[0] || 'direct'} subjects - test questions, benefits, or curiosity-gap approaches for comparison`;
  } else {
    keyInsight = 'No clear winning formula - run A/B tests on question vs benefit approaches';
  }

  const calcAvgLength = (subjects: typeof topSubjects) =>
    subjects.length ? Math.round(subjects.reduce((sum, s) => sum + s.subject.length, 0) / subjects.length) : 0;
  const calcPersonalization = (subjects: typeof topSubjects) => {
    if (!subjects.length) return 0;
    return Math.round((subjects.filter(s => s.subject.includes('{{') || s.subject.toLowerCase().includes('first_name')).length / subjects.length) * 100);
  };
  const calcQuestion = (subjects: typeof topSubjects) => {
    if (!subjects.length) return 0;
    return Math.round((subjects.filter(s => s.subject.includes('?')).length / subjects.length) * 100);
  };

  const topAvgInterest = topCampaigns.length
    ? parseFloat((topCampaigns.reduce((s, c) => s + c.interestRate, 0) / topCampaigns.length).toFixed(2))
    : 0;
  const bottomAvgInterest = bottomCampaigns.length
    ? parseFloat((bottomCampaigns.reduce((s, c) => s + c.interestRate, 0) / bottomCampaigns.length).toFixed(2))
    : 0;

  return {
    subjects: {
      aggregated: aggregatedSubjects,
      topPerformers: topSubjects,
      bottomPerformers: bottomSubjects,
      patterns: {
        avgLength: { top: calcAvgLength(topSubjects), bottom: calcAvgLength(bottomSubjects) },
        hasPersonalization: { top: calcPersonalization(topSubjects), bottom: calcPersonalization(bottomSubjects) },
        hasQuestion: { top: calcQuestion(topSubjects), bottom: calcQuestion(bottomSubjects) },
      },
      analysis: {
        topTypeBreakdown,
        bottomTypeBreakdown,
        winningPattern,
        failingPattern,
        redundancy,
        keyInsight,
      },
    },
    summary: {
      topAvgInterest,
      bottomAvgInterest,
      totalCampaignsAnalyzed: withInterest.length,
      interestGap: parseFloat((topAvgInterest - bottomAvgInterest).toFixed(2)),
    },
  };
}

// ── GET handler ──────────────────────────────────────────────────────

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cycleParam = url.searchParams.get('cycle');

    await switchWorkspace(SELERY_WORKSPACE_ID).catch(() => {});

    const campaigns = await getAllCampaigns();

    // Apply cycle filter if requested
    const cycleFilter = cycleParam ? parseInt(cycleParam, 10) : null;
    const cycleRegex = cycleFilter !== null ? new RegExp(`^Cycle\\s+${cycleFilter}\\b`, 'i') : null;

    const filteredCampaigns = cycleRegex
      ? campaigns.filter(c => cycleRegex.test(c.name))
      : campaigns;

    const activeCampaigns = filteredCampaigns.filter(c =>
      c.emails_sent > 0 &&
      !['draft', 'archived', 'failed'].includes(c.status.toLowerCase())
    );

    // Get stats for subject lines
    const now = new Date();
    const startDate = '2025-01-01';
    const endDate = now.toISOString().split('T')[0];

    const campaignDetailsRaw = await Promise.all(
      activeCampaigns.slice(0, 20).map(async (campaign) => {
        try {
          const { data } = await getCampaignStats(campaign.id, startDate, endDate);
          const subjectLine = data.sequence_step_stats?.[0]?.email_subject || '';
          const cleanSubject = subjectLine.split('|')[0].replace('{', '').replace('}', '').trim();
          return { campaign, subjectLine: cleanSubject || campaign.name };
        } catch {
          return { campaign, subjectLine: campaign.name };
        }
      })
    );

    const campaignDetails: CampaignWithSubject[] = campaignDetailsRaw.map(({ campaign, subjectLine }) => {
      const denominator = campaign.total_leads_contacted > 0 ? campaign.total_leads_contacted : campaign.emails_sent;
      return {
        campaign,
        subjectLine,
        interestRate: denominator > 0 ? parseFloat(((campaign.interested / denominator) * 100).toFixed(2)) : 0,
        replyRate: denominator > 0 ? parseFloat(((campaign.unique_replies / denominator) * 100).toFixed(2)) : 0,
      };
    });

    // Build subject analysis
    const copyAnalysis = buildCopyAnalysis(campaignDetails);

    // Fetch sequence steps for body/CTA analysis (up to 9 campaigns)
    const sequenceData: Array<{
      body: string; interestRate: number; campaign: string;
      leadsContacted?: number; interested?: number; replies?: number; sent?: number;
    }> = [];

    for (const detail of campaignDetails.slice(0, 15)) {
      try {
        const seqResponse = await getCampaignSequenceSteps(detail.campaign.id);
        if (seqResponse.data?.[0]?.body) {
          sequenceData.push({
            body: seqResponse.data[0].body,
            interestRate: detail.interestRate,
            campaign: detail.campaign.name.split(':')[0].split('-')[0].trim(),
            leadsContacted: detail.campaign.total_leads_contacted,
            interested: detail.campaign.interested,
            replies: detail.campaign.unique_replies,
            sent: detail.campaign.emails_sent,
          });
        }
      } catch {
        // Skip if sequence not available
      }
    }

    // Add body and CTA analysis if we have enough data
    let body = copyAnalysis.body;
    let cta = copyAnalysis.cta;

    if (sequenceData.length >= 3) {
      body = analyzeBodyPatterns(sequenceData);
      cta = analyzeCTAPatterns(sequenceData);
    }

    const result: CopyAnalysis = {
      ...copyAnalysis,
      body,
      cta,
    };

    return NextResponse.json({ data: result }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=120' },
    });
  } catch (error) {
    console.error('[Analytics/Copy] Error:', error);
    return NextResponse.json(
      { error: 'Failed to generate copy analysis' },
      { status: 500 }
    );
  }
}
