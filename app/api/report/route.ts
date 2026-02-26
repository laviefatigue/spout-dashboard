import { NextResponse } from 'next/server';
import type {
  Campaign,
  CampaignPerformance,
  InterestedLeadDetail,
  ReportInsight,
  PerformanceReport,
  AggregatedCopyVariant,
  OpenerType as OpenerTypeImport,
  CTAType as CTATypeImport,
} from '@/lib/types/emailbison';

const EMAILBISON_API_URL = process.env.EMAILBISON_API_URL || 'https://spellcast.hirecharm.com';
const EMAILBISON_API_TOKEN = process.env.EMAILBISON_API_TOKEN || '';

interface Reply {
  id: number;
  subject: string;
  from_email_address: string;
  from_name: string;
  text_body: string;
  html_body: string;
  interested: boolean;
  automated_reply: boolean;
  folder: string;
  campaign_id: number;
  lead_id: number | null;
  date_received: string;
}

interface Lead {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  company: string | null;
  title: string | null;
  custom_variables: Array<{ name: string; value: string | null }>;
  lead_campaign_data: Array<{
    campaign_id: number;
    interested: boolean;
    status: string;
    replies: number;
  }>;
  overall_stats: {
    replies: number;
    unique_replies: number;
  };
}

async function fetchApi<T>(endpoint: string): Promise<T> {
  const response = await fetch(`${EMAILBISON_API_URL}${endpoint}`, {
    headers: {
      'Authorization': `Bearer ${EMAILBISON_API_TOKEN}`,
      'Accept': 'application/json',
    },
    next: { revalidate: 300 }, // Cache for 5 minutes
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
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
    next: { revalidate: 300 }, // Cache for 5 minutes
  });
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

// Trust EmailBison's interested flag - no custom filtering
function isRealInterest(reply: Reply): boolean {
  return reply.interested === true;
}

function extractIndustry(lead: Lead, campaignName: string): string {
  // Check custom variables first
  const category = lead.custom_variables?.find(v => v.name === 'category')?.value;
  if (category) return category;

  // Fall back to campaign name
  const lower = campaignName.toLowerCase();
  if (lower.includes('solar')) return 'Solar';
  if (lower.includes('retail')) return 'Retail';
  if (lower.includes('prepper')) return 'Preparedness';
  if (lower.includes('van life')) return 'Outdoor/RV';
  if (lower.includes('water')) return 'Water Systems';
  if (lower.includes('hotel') || lower.includes('resort')) return 'Hospitality';
  if (lower.includes('tiny home') || lower.includes('adu')) return 'Construction';
  if (lower.includes('warehouse')) return 'Wholesale';
  return 'Other';
}

interface CampaignWithSubject {
  campaign: Campaign;
  subjectLine: string;
  interestRate: number;
  replyRate: number;
}

interface SequenceStep {
  id: number;
  email_subject: string;
  email_body: string;
  order: number;
  thread_reply: boolean;
}

// Clean HTML body to plain text
function cleanBodyText(htmlBody: string): string {
  return htmlBody
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}|]+\|[^}]+\}/g, (match) => match.split('|')[0].replace('{', ''))
    .replace(/\{([^}]+)\}/g, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract opening hook from email body (first meaningful line)
function extractOpeningHook(htmlBody: string): string {
  const text = cleanBodyText(htmlBody);
  const firstSentence = text.split(/[.!?]/)[0]?.trim() || '';
  return firstSentence.length > 120 ? firstSentence.substring(0, 120) + '...' : firstSentence;
}

// Extract CTA from email body (last question or call to action)
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

// Categorize subject line type
type SubjectType = 'question' | 'benefit' | 'curiosity' | 'direct' | 'pain' | 'personalized';
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

// Categorize opener type
type OpenerType = 'pain-first' | 'benefit-first' | 'question' | 'story' | 'direct-offer' | 'social-proof' | 'personalized';
function categorizeOpener(text: string): OpenerType[] {
  const lower = text.toLowerCase();
  const types: OpenerType[] = [];

  // Check for personalization first
  if (lower.includes('first_name') || lower.includes('{{') || lower.match(/^(hey|hi)\s+\w+/)) {
    types.push('personalized');
  }

  // Pain-first: starts with problem
  if (lower.match(/^(struggling|frustrated|tired|sick of|dealing with|if you're|most |many )/)) {
    types.push('pain-first');
  }

  // Benefit-first: starts with result/value
  if (lower.match(/^(we |our |i |just |recently |we've |i've ).*?(help|save|increase|grow|boost)/)) {
    types.push('benefit-first');
  }

  // Question opener
  if (text.split(/[.!]/)[0]?.includes('?')) {
    types.push('question');
  }

  // Direct offer
  if (lower.match(/^(want|would you|can i|let me|i'd like to)/)) {
    types.push('direct-offer');
  }

  // Social proof / story
  if (lower.match(/(we just|we recently|one of our|a client|a company|working with)/)) {
    types.push('story');
  }

  if (lower.match(/(\d+%|\d+x|roi|companies|clients|results)/)) {
    types.push('social-proof');
  }

  if (types.length === 0) types.push('direct-offer');
  return types;
}

// Categorize CTA type
type CTAType = 'free-offer' | 'meeting-request' | 'soft-question' | 'demo' | 'info-request' | 'urgent';
function categorizeCTA(text: string): { type: CTAType; commitment: 'low' | 'medium' | 'high' } {
  const lower = text.toLowerCase();

  // Free offer (lowest commitment)
  if (lower.match(/send you|free|sample|try|unit|test|complimentary/)) {
    return { type: 'free-offer', commitment: 'low' };
  }

  // Soft question (low commitment)
  if (lower.match(/^(want|interested|would you|open to|curious)/i) && text.includes('?')) {
    return { type: 'soft-question', commitment: 'low' };
  }

  // Info request (medium)
  if (lower.match(/learn more|more info|details|send.*info/)) {
    return { type: 'info-request', commitment: 'medium' };
  }

  // Demo (medium-high)
  if (lower.match(/demo|show you|walk.*through/)) {
    return { type: 'demo', commitment: 'medium' };
  }

  // Meeting request (high commitment)
  if (lower.match(/call|chat|meeting|schedule|book|15 min|30 min|time/)) {
    return { type: 'meeting-request', commitment: 'high' };
  }

  // Urgent
  if (lower.match(/today|now|asap|this week|limited/)) {
    return { type: 'urgent', commitment: 'high' };
  }

  return { type: 'soft-question', commitment: 'medium' };
}

// Find similar/redundant subjects
function findRedundantSubjects(subjects: Array<{ subject: string; interestRate: number }>): string[] {
  const redundant: string[] = [];
  const normalized = subjects.map(s => ({
    ...s,
    normalized: s.subject.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).sort().join(' ')
  }));

  const seen = new Map<string, number>();
  for (const s of normalized) {
    const key = s.normalized.substring(0, 30); // First 30 chars as key
    if (seen.has(key)) {
      redundant.push(`"${s.subject}" similar to previous`);
    } else {
      seen.set(key, s.interestRate);
    }
  }
  return redundant;
}

// Deep analysis of body patterns
function analyzeBodyPatterns(sequences: Array<{ body: string; interestRate: number; campaign: string; leadsContacted?: number; interested?: number; replies?: number; sent?: number }>): {
  aggregated: AggregatedCopyVariant[];
  topHooks: string[];
  bottomHooks: string[];
  keyPattern: string;
  analysis: {
    topOpenerTypes: Record<OpenerType, number>;
    bottomOpenerTypes: Record<OpenerType, number>;
    winningApproach: string;
    failingApproach: string;
    contrast: string;
  };
} {
  const sorted = [...sequences].sort((a, b) => b.interestRate - a.interestRate);
  const midpoint = Math.ceil(sorted.length / 2);
  const top = sorted.slice(0, Math.max(3, midpoint));
  const bottom = sorted.slice(-Math.max(3, midpoint));

  // === NEW: Aggregate hooks across campaigns ===
  const hookMap = new Map<string, typeof sequences>();
  for (const s of sequences) {
    const hook = extractOpeningHook(s.body);
    const key = hook.toLowerCase().substring(0, 50); // Normalize by first 50 chars
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
    // Use unweighted avg if no leads data
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
      openerType: openerTypes[0] as OpenerTypeImport,
    });
  }
  aggregatedHooks.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);
  // === END aggregation ===

  const topHooks = top.map(s => extractOpeningHook(s.body)).filter(h => h.length > 10);
  const bottomHooks = bottom.map(s => extractOpeningHook(s.body)).filter(h => h.length > 10);

  // Categorize openers
  const topOpenerTypes: Record<OpenerType, number> = {
    'pain-first': 0, 'benefit-first': 0, 'question': 0, 'story': 0,
    'direct-offer': 0, 'social-proof': 0, 'personalized': 0
  };
  const bottomOpenerTypes: Record<OpenerType, number> = { ...topOpenerTypes };

  for (const s of top) {
    const types = categorizeOpener(cleanBodyText(s.body));
    types.forEach(t => topOpenerTypes[t]++);
  }
  for (const s of bottom) {
    const types = categorizeOpener(cleanBodyText(s.body));
    types.forEach(t => bottomOpenerTypes[t]++);
  }

  // Find the dominant winning type
  const topSorted = Object.entries(topOpenerTypes).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomOpenerTypes).sort((a, b) => b[1] - a[1]);

  const winningType = topSorted[0]?.[0] || 'direct-offer';
  const losingType = bottomSorted[0]?.[0] || 'direct-offer';

  // Build contrast insight
  let contrast = '';
  let winningApproach = '';
  let failingApproach = '';

  // Check for personalization difference
  const topPersonalized = topOpenerTypes['personalized'];
  const bottomPersonalized = bottomOpenerTypes['personalized'];
  if (topPersonalized > bottomPersonalized + 1) {
    contrast = 'Personalized openers significantly outperform generic ones';
    winningApproach = `${topPersonalized}/${top.length} top performers use personalization`;
  } else if (bottomPersonalized > topPersonalized + 1) {
    contrast = 'Personalization alone isn\'t driving results - value prop matters more';
  }

  // Check for question vs statement
  const topQuestions = topOpenerTypes['question'];
  const bottomQuestions = bottomOpenerTypes['question'];
  if (topQuestions > bottomQuestions + 1) {
    contrast = contrast || 'Question-based openers create curiosity and drive engagement';
    winningApproach = winningApproach || `Questions work: ${topQuestions}/${top.length} winners vs ${bottomQuestions}/${bottom.length} losers`;
  }

  // Check for direct offers
  const topDirectOffer = topOpenerTypes['direct-offer'];
  const bottomDirectOffer = bottomOpenerTypes['direct-offer'];
  if (topDirectOffer > bottomDirectOffer + 1) {
    contrast = contrast || 'Direct, clear value props outperform clever copy';
  } else if (bottomDirectOffer > topDirectOffer + 1) {
    failingApproach = `Direct pitches underperform: ${bottomDirectOffer}/${bottom.length} in low performers`;
  }

  // Social proof check
  if (topOpenerTypes['social-proof'] > bottomOpenerTypes['social-proof']) {
    winningApproach = winningApproach || 'Social proof elements (numbers, client mentions) boost credibility';
  }

  // Default insights if none found
  if (!contrast) {
    if (winningType === losingType) {
      // Same dominant type in both - no differentiation
      contrast = `All campaigns use similar ${winningType.replace('-', ' ')} openers. Test different approaches: pain-first, question-based, or social proof.`;
    } else {
      contrast = `${winningType.replace('-', ' ')} openers trending higher than ${losingType.replace('-', ' ')}`;
    }
  }
  if (!winningApproach) {
    winningApproach = `Top approach: ${winningType.replace('-', ' ')} (${topSorted[0]?.[1] || 0}/${top.length} top campaigns)`;
  }
  if (!failingApproach) {
    if (winningType === losingType) {
      failingApproach = `No clear failing pattern - all campaigns use ${losingType.replace('-', ' ')} openers`;
    } else {
      failingApproach = `Underperforming: ${losingType.replace('-', ' ')} heavy in bottom ${bottom.length} campaigns`;
    }
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

// Deep analysis of CTA patterns
function analyzeCTAPatterns(sequences: Array<{ body: string; interestRate: number; campaign: string; leadsContacted?: number; interested?: number; replies?: number; sent?: number }>): {
  aggregated: AggregatedCopyVariant[];
  topCTAs: string[];
  bottomCTAs: string[];
  keyPattern: string;
  analysis: {
    topCTATypes: Record<CTAType, number>;
    bottomCTATypes: Record<CTAType, number>;
    commitmentAnalysis: string;
    winningCTAType: string;
    failingCTAType: string;
  };
} {
  const sorted = [...sequences].sort((a, b) => b.interestRate - a.interestRate);
  const midpoint = Math.ceil(sorted.length / 2);
  const top = sorted.slice(0, Math.max(3, midpoint));
  const bottom = sorted.slice(-Math.max(3, midpoint));

  // === NEW: Aggregate CTAs across campaigns ===
  const ctaMap = new Map<string, typeof sequences>();
  for (const s of sequences) {
    const cta = extractCTA(s.body);
    const key = cta.toLowerCase().substring(0, 40); // Normalize by first 40 chars
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
      ctaType: ctaType as CTATypeImport,
    });
  }
  aggregatedCTAs.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);
  // === END aggregation ===

  const topCTAs = top.map(s => extractCTA(s.body)).filter(c => c.length > 5);
  const bottomCTAs = bottom.map(s => extractCTA(s.body)).filter(c => c.length > 5);

  // Categorize CTAs
  const topCTATypes: Record<CTAType, number> = {
    'free-offer': 0, 'meeting-request': 0, 'soft-question': 0,
    'demo': 0, 'info-request': 0, 'urgent': 0
  };
  const bottomCTATypes: Record<CTAType, number> = { ...topCTATypes };

  let topLowCommit = 0, topHighCommit = 0;
  let bottomLowCommit = 0, bottomHighCommit = 0;

  for (const s of top) {
    const cta = extractCTA(s.body);
    const { type, commitment } = categorizeCTA(cta);
    topCTATypes[type]++;
    if (commitment === 'low') topLowCommit++;
    if (commitment === 'high') topHighCommit++;
  }

  for (const s of bottom) {
    const cta = extractCTA(s.body);
    const { type, commitment } = categorizeCTA(cta);
    bottomCTATypes[type]++;
    if (commitment === 'low') bottomLowCommit++;
    if (commitment === 'high') bottomHighCommit++;
  }

  // Find winning/losing CTA types
  const topSorted = Object.entries(topCTATypes).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomCTATypes).sort((a, b) => b[1] - a[1]);

  const winningCTAType = topSorted[0]?.[0] || 'soft-question';
  const failingCTAType = bottomSorted[0]?.[0] || 'meeting-request';

  // Commitment level analysis
  let commitmentAnalysis = '';
  if (topLowCommit > topHighCommit && bottomHighCommit > bottomLowCommit) {
    commitmentAnalysis = `Low-commitment CTAs dominate winners (${topLowCommit}/${top.length}). High-commitment asks failing (${bottomHighCommit}/${bottom.length} in bottom).`;
  } else if (topHighCommit > topLowCommit) {
    commitmentAnalysis = `High-commitment CTAs working for this audience - they're ready to engage.`;
  } else {
    commitmentAnalysis = `Mixed commitment levels - test more low-friction asks like free samples/trials.`;
  }

  // Key pattern
  let keyPattern = '';
  if (topCTATypes['free-offer'] > bottomCTATypes['free-offer'] + 1) {
    keyPattern = 'Free offer/sample CTAs dramatically outperform meeting requests';
  } else if (topCTATypes['soft-question'] > bottomCTATypes['soft-question'] + 1) {
    keyPattern = 'Permission-based questions ("Want a...?") beat direct asks';
  } else if (bottomCTATypes['meeting-request'] > topCTATypes['meeting-request'] + 1) {
    keyPattern = 'Meeting/call requests underperforming - reduce friction with softer asks';
  } else if (winningCTAType === failingCTAType) {
    // Same CTA type in both - no differentiation to analyze
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

function buildCopyAnalysis(campaignDetails: CampaignWithSubject[]): {
  subjects: {
    aggregated: AggregatedCopyVariant[];
    topPerformers: Array<{ subject: string; campaign: string; interestRate: number; replyRate: number; sent: number; types: SubjectType[] }>;
    bottomPerformers: Array<{ subject: string; campaign: string; interestRate: number; replyRate: number; sent: number; types: SubjectType[] }>;
    patterns: {
      avgLength: { top: number; bottom: number };
      hasPersonalization: { top: number; bottom: number };
      hasQuestion: { top: number; bottom: number };
    };
    analysis: {
      topTypeBreakdown: Record<SubjectType, number>;
      bottomTypeBreakdown: Record<SubjectType, number>;
      winningPattern: string;
      failingPattern: string;
      redundancy: string[];
      keyInsight: string;
    };
  };
  summary: { topAvgInterest: number; bottomAvgInterest: number; totalCampaignsAnalyzed: number; interestGap: number };
} {
  // Sort campaigns by interest rate
  const sorted = [...campaignDetails].sort((a, b) => b.interestRate - a.interestRate);
  const withInterest = sorted.filter(c => c.campaign.emails_sent >= 100);

  // === NEW: Aggregate subjects across campaigns ===
  const subjectMap = new Map<string, CampaignWithSubject[]>();
  for (const c of withInterest) {
    const key = c.subjectLine.toLowerCase().trim();
    if (!subjectMap.has(key)) subjectMap.set(key, []);
    subjectMap.get(key)!.push(c);
  }

  // Build aggregated subjects with weighted metrics
  const aggregatedSubjects: AggregatedCopyVariant[] = [];
  for (const [, campaigns] of subjectMap) {
    const totalLeads = campaigns.reduce((s, c) => s + c.campaign.total_leads_contacted, 0);
    const totalInterested = campaigns.reduce((s, c) => s + c.campaign.interested, 0);
    const totalReplies = campaigns.reduce((s, c) => s + c.campaign.unique_replies, 0);
    const totalSent = campaigns.reduce((s, c) => s + c.campaign.emails_sent, 0);

    aggregatedSubjects.push({
      copy: campaigns[0].subjectLine, // Use original casing
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

  // Sort aggregated by weighted interest rate
  aggregatedSubjects.sort((a, b) => b.weightedInterestRate - a.weightedInterestRate);
  // === END aggregation ===

  // Legacy: Deduplicate by subject line - keep best performer for each unique subject
  const seenSubjectsTop = new Set<string>();
  const topCampaigns = withInterest.filter(c => {
    const subjectKey = c.subjectLine.toLowerCase().trim();
    if (seenSubjectsTop.has(subjectKey)) return false;
    seenSubjectsTop.add(subjectKey);
    return true;
  }).slice(0, 5);

  // For bottom performers, work from the end (worst first), dedupe
  const seenSubjectsBottom = new Set<string>();
  const reversedForBottom = [...withInterest].reverse();
  const bottomCampaigns = reversedForBottom.filter(c => {
    const subjectKey = c.subjectLine.toLowerCase().trim();
    if (seenSubjectsBottom.has(subjectKey)) return false;
    seenSubjectsBottom.add(subjectKey);
    return true;
  }).slice(0, 5);

  // Build subject line analysis with types
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

  // Calculate type breakdowns
  const topTypeBreakdown: Record<SubjectType, number> = {
    question: 0, benefit: 0, curiosity: 0, direct: 0, pain: 0, personalized: 0
  };
  const bottomTypeBreakdown: Record<SubjectType, number> = { ...topTypeBreakdown };

  topSubjects.forEach(s => s.types.forEach(t => topTypeBreakdown[t]++));
  bottomSubjects.forEach(s => s.types.forEach(t => bottomTypeBreakdown[t]++));

  // Find winning/failing patterns
  const topSorted = Object.entries(topTypeBreakdown).sort((a, b) => b[1] - a[1]);
  const bottomSorted = Object.entries(bottomTypeBreakdown).sort((a, b) => b[1] - a[1]);

  let winningPattern = '';
  let failingPattern = '';
  let keyInsight = '';

  // Analyze contrasts
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

  // Check for redundancy FIRST - it's the most important finding
  const allSubjects = withInterest.map(c => ({ subject: c.subjectLine, interestRate: c.interestRate }));
  const redundancy = findRedundantSubjects(allSubjects);

  // Check for personalization impact
  if (redundancy.length >= withInterest.length * 0.5) {
    // More than 50% redundancy - this is the main issue
    keyInsight = `CRITICAL: ${redundancy.length + 1} campaigns use the same subject line. Cannot analyze patterns without variation - test diverse subject lines.`;
  } else if (topTypeBreakdown.personalized > bottomTypeBreakdown.personalized) {
    keyInsight = 'Personalization correlates with higher interest - use {{first_name}} and company variables';
  } else if (topTypeBreakdown.question > bottomTypeBreakdown.question) {
    keyInsight = 'Questions create engagement - test more subject lines ending with "?"';
  } else if (topTypeBreakdown.curiosity > bottomTypeBreakdown.curiosity) {
    keyInsight = 'Curiosity gaps work - "Quick thought" or "This" outperform explicit subjects';
  } else if (topSorted[0]?.[0] === bottomSorted[0]?.[0]) {
    // Same type dominates both - no differentiation
    keyInsight = `All campaigns use ${topSorted[0]?.[0] || 'direct'} subjects - test questions, benefits, or curiosity-gap approaches for comparison`;
  } else {
    keyInsight = 'No clear winning formula - run A/B tests on question vs benefit approaches';
  }

  // Calculate metrics
  const calcAvgLength = (subjects: typeof topSubjects) =>
    subjects.length ? Math.round(subjects.reduce((sum, s) => sum + s.subject.length, 0) / subjects.length) : 0;

  const calcPersonalization = (subjects: typeof topSubjects) => {
    if (!subjects.length) return 0;
    const withVars = subjects.filter(s => s.subject.includes('{{') || s.subject.toLowerCase().includes('first_name')).length;
    return Math.round((withVars / subjects.length) * 100);
  };

  const calcQuestion = (subjects: typeof topSubjects) => {
    if (!subjects.length) return 0;
    const withQuestion = subjects.filter(s => s.subject.includes('?')).length;
    return Math.round((withQuestion / subjects.length) * 100);
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

interface User {
  id: number;
  name: string;
  email: string;
  workspace?: { id: number; name: string };
  team?: { id: number; name: string };
}

export async function GET(request: Request) {
  try {
    // Check for workspace_id query parameter
    const url = new URL(request.url);
    const workspaceId = url.searchParams.get('workspace_id');

    // Switch workspace if specified, otherwise default to Selery (22)
    const targetWorkspaceId = workspaceId ? parseInt(workspaceId) : 22; // Default to Selery
    try {
      await postApi<{ data: { id: number; name: string } }>('/api/workspaces/switch-workspace', {
        team_id: targetWorkspaceId
      });
    } catch {
      // Continue with current workspace if switch fails
    }

    // Fetch user info to get workspace name
    let workspaceName = 'EmailBison';
    try {
      const userResponse = await fetchApi<{ data: User }>('/api/users');
      workspaceName = userResponse.data.workspace?.name || userResponse.data.team?.name || 'EmailBison';
    } catch {
      // Fall back to default name
    }

    // Fetch all campaigns
    const { data: campaigns } = await fetchApi<{ data: Campaign[] }>('/api/campaigns');
    // Only include active, completed, launching campaigns (exclude draft, paused, failed, archived, stopped)
    // Note: API returns lowercase status values
    const activeCampaigns = campaigns.filter(c =>
      c.emails_sent > 0 &&
      ['active', 'completed', 'launching'].includes(c.status.toLowerCase())
    );

    // Fetch interested replies from Inbox folder (paginated)
    // Note: API ignores per_page and returns 15 per page, so we need many pages
    let allReplies: Reply[] = [];
    let page = 1;
    const maxPages = 100; // Fetch up to 1500 interested replies (15 per page)

    while (page <= maxPages) {
      try {
        // Use folder=inbox and interested=1 for filtering interested replies
        const repliesResponse = await fetchApi<{
          data: Reply[];
          meta?: { last_page: number; current_page: number }
        }>(`/api/replies?folder=inbox&interested=1&page=${page}`);

        if (Array.isArray(repliesResponse.data)) {
          allReplies = [...allReplies, ...repliesResponse.data];
          if (!repliesResponse.meta || page >= repliesResponse.meta.last_page) break;
        } else {
          break;
        }
        page++;
      } catch {
        break;
      }
    }

    // Filter for REAL interested replies (not bounces/OOO)
    // Also filter to only include replies from campaigns in this workspace
    const campaignIds = new Set(activeCampaigns.map(c => c.id));
    const realInterestedReplies = allReplies.filter(reply =>
      isRealInterest(reply) && campaignIds.has(reply.campaign_id)
    );

    // Get campaign stats with subject lines
    const campaignDetailsRaw = await Promise.all(
      activeCampaigns.slice(0, 15).map(async (campaign) => {
        try {
          const statsResponse = await postApi<{
            data: {
              sequence_step_stats?: Array<{
                email_subject: string;
                sent: number;
                unique_replies: number;
                interested: number;
              }>;
            };
          }>(`/api/campaigns/${campaign.id}/stats`, {
            start_date: '2024-01-01',
            end_date: new Date().toISOString().split('T')[0],
          });

          const subjectLine = statsResponse.data.sequence_step_stats?.[0]?.email_subject || '';
          const cleanSubject = subjectLine.split('|')[0].replace('{', '').replace('}', '').trim();

          return { campaign, subjectLine: cleanSubject || campaign.name };
        } catch {
          return { campaign, subjectLine: campaign.name };
        }
      })
    );

    // Enrich campaign details with rates for analysis
    // IMPORTANT: Use total_leads_contacted (unique people) not emails_sent (includes follow-ups)
    const campaignDetails: CampaignWithSubject[] = campaignDetailsRaw.map(({ campaign, subjectLine }) => {
      const denominator = campaign.total_leads_contacted > 0 ? campaign.total_leads_contacted : campaign.emails_sent;
      return {
        campaign,
        subjectLine,
        interestRate: denominator > 0
          ? parseFloat(((campaign.interested / denominator) * 100).toFixed(2))
          : 0,
        replyRate: denominator > 0
          ? parseFloat(((campaign.unique_replies / denominator) * 100).toFixed(2))
          : 0,
      };
    });

    // Build campaign performances with extended stats
    const campaignPerformances: CampaignPerformance[] = campaignDetails
      .map(({ campaign, subjectLine, interestRate, replyRate }) => ({
        rank: 0,
        id: campaign.id,
        name: campaign.name,
        subjectLine,
        replyRate,
        interestRate,
        // Extended stats for expanded view
        leadsContacted: campaign.total_leads_contacted,
        emailsSent: campaign.emails_sent,
        uniqueReplies: campaign.unique_replies,
        interested: campaign.interested,
      }))
      .sort((a, b) => b.interestRate - a.interestRate)
      .map((c, i) => ({ ...c, rank: i + 1 }));

    // Build data-driven copy analysis
    const copyAnalysis = buildCopyAnalysis(campaignDetails);

    // Fetch sequences for body/CTA analysis
    const sequenceData: Array<{
      body: string;
      interestRate: number;
      campaign: string;
      leadsContacted?: number;
      interested?: number;
      replies?: number;
      sent?: number;
    }> = [];
    for (const detail of campaignDetails.slice(0, 9)) {
      try {
        const seqResponse = await fetchApi<{ data: SequenceStep[] }>(
          `/api/campaigns/${detail.campaign.id}/sequence-steps`
        );
        if (seqResponse.data?.[0]?.email_body) {
          sequenceData.push({
            body: seqResponse.data[0].email_body,
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

    // Add body and CTA analysis if we have sequence data
    let bodyAnalysis: {
      aggregated?: AggregatedCopyVariant[];
      topHooks: string[];
      bottomHooks: string[];
      keyPattern: string;
      analysis?: {
        topOpenerTypes: Record<OpenerType, number>;
        bottomOpenerTypes: Record<OpenerType, number>;
        winningApproach: string;
        failingApproach: string;
        contrast: string;
      };
    } = {
      aggregated: [],
      topHooks: [],
      bottomHooks: [],
      keyPattern: ''
    };
    let ctaAnalysis: {
      aggregated?: AggregatedCopyVariant[];
      topCTAs: string[];
      bottomCTAs: string[];
      keyPattern: string;
      analysis?: {
        topCTATypes: Record<CTAType, number>;
        bottomCTATypes: Record<CTAType, number>;
        commitmentAnalysis: string;
        winningCTAType: string;
        failingCTAType: string;
      };
    } = {
      aggregated: [],
      topCTAs: [],
      bottomCTAs: [],
      keyPattern: ''
    };

    if (sequenceData.length >= 3) {
      bodyAnalysis = analyzeBodyPatterns(sequenceData);
      ctaAnalysis = analyzeCTAPatterns(sequenceData);
    }

    // Build enhanced lead details from replies
    const campaignMap = new Map(campaigns.map(c => [c.id, c.name]));
    const leadsMap = new Map<string, InterestedLeadDetail>();

    // Extract industry from campaign name
    function extractIndustryFromCampaign(campaignName: string): string {
      const lower = campaignName.toLowerCase();
      if (lower.includes('solar')) return 'Solar';
      if (lower.includes('retail')) return 'Retail';
      if (lower.includes('prepper')) return 'Preparedness';
      if (lower.includes('van life')) return 'Outdoor/RV';
      if (lower.includes('water')) return 'Water Systems';
      if (lower.includes('hotel') || lower.includes('resort')) return 'Hospitality';
      if (lower.includes('tiny home') || lower.includes('adu')) return 'Construction';
      if (lower.includes('warehouse')) return 'Wholesale';
      if (lower.includes('software') || lower.includes('saas')) return 'Software';
      if (lower.includes('agency')) return 'Agency';
      return 'Other';
    }

    // Fetch lead details for interested replies (to get title, company, LinkedIn, etc.)
    const leadIds = [...new Set(realInterestedReplies.map(r => r.lead_id).filter((id): id is number => id !== null))];
    const leadDetailsMap = new Map<number, Lead>();

    // Fetch lead details in batches of 10
    for (let i = 0; i < Math.min(leadIds.length, 100); i += 10) {
      const batch = leadIds.slice(i, i + 10);
      const leadPromises = batch.map(async (leadId) => {
        try {
          const response = await fetchApi<{ data: Lead }>(`/api/leads/${leadId}`);
          if (response.data) {
            leadDetailsMap.set(leadId, response.data);
          }
        } catch {
          // Skip if lead fetch fails
        }
      });
      await Promise.all(leadPromises);
    }

    // Build lead details from replies (dedupe by email)
    for (const reply of realInterestedReplies) {
      const email = reply.from_email_address.toLowerCase();
      if (leadsMap.has(email)) continue; // Skip duplicates

      const campaignName = campaignMap.get(reply.campaign_id) || 'Unknown Campaign';
      const leadDetail = reply.lead_id ? leadDetailsMap.get(reply.lead_id) : null;

      // Use lead details if available, otherwise extract from email/reply
      const company = leadDetail?.company || (() => {
        const domain = email.split('@')[1] || '';
        const companyFromDomain = domain.split('.')[0] || '';
        return companyFromDomain.charAt(0).toUpperCase() + companyFromDomain.slice(1);
      })();

      const name = leadDetail
        ? `${leadDetail.first_name} ${leadDetail.last_name}`.trim()
        : reply.from_name || email.split('@')[0];

      leadsMap.set(email, {
        id: reply.lead_id || reply.id,
        email,
        name,
        company,
        title: leadDetail?.title || '',
        industry: extractIndustryFromCampaign(campaignName),
        campaign: campaignName.split(':')[0].split('-')[0].trim(),
        campaignId: reply.campaign_id,
        subject: reply.subject.replace(/^Re:\s*/i, '').replace(/^\[External\]\s*/i, '').trim(),
        replyPreview: (reply.text_body || '').substring(0, 200).trim(),
        replyDate: reply.date_received,
        replyId: reply.id,
      });
    }

    // Aggregate metrics first (needed for lead count)
    const totalCampaigns = activeCampaigns.length;
    const totalSent = activeCampaigns.reduce((sum, c) => sum + c.emails_sent, 0);
    const totalLeadsContacted = activeCampaigns.reduce((sum, c) => sum + c.total_leads_contacted, 0);
    // Simple average of campaign reply rates (not weighted by volume)
    const avgResponseRate = campaignPerformances.length > 0
      ? campaignPerformances.reduce((sum, c) => sum + c.replyRate, 0) / campaignPerformances.length
      : 0;

    // Convert to array and sort by date (most recent first)
    const interestedLeads = Array.from(leadsMap.values());
    interestedLeads.sort((a, b) => new Date(b.replyDate).getTime() - new Date(a.replyDate).getTime());

    // Use unique lead count (deduped by email) as the authoritative interested count
    // Campaign stats may double-count people who replied to multiple campaigns
    const totalInterested = interestedLeads.length;

    // Extract unique campaigns and industries for filters
    const uniqueCampaigns = [...new Set(interestedLeads.map(l => l.campaign))].sort();
    const uniqueIndustries = [...new Set(interestedLeads.map(l => l.industry))].sort();

    // Generate insights
    const insights: ReportInsight[] = [];

    // Top performer
    if (campaignPerformances[0]?.interestRate > 0) {
      insights.push({
        type: 'success',
        emoji: '🏆',
        headline: `"${campaignPerformances[0].name.split(':')[0]}" leads at ${campaignPerformances[0].interestRate}%`,
        detail: `Subject: "${campaignPerformances[0].subjectLine}"`
      });
    }

    // Real interested count
    insights.push({
      type: 'success',
      emoji: '📧',
      headline: `${realInterestedReplies.length} verified interested replies`,
      detail: `Out of ${allReplies.length} total flagged as interested (filtered bounces/OOO)`
    });

    // Reply-to-interest gap
    const gapCampaigns = campaignPerformances.filter(c => c.replyRate > 3 && c.interestRate < 2);
    if (gapCampaigns.length > 0) {
      insights.push({
        type: 'warning',
        emoji: '⚠️',
        headline: `${gapCampaigns.length} campaigns with reply-interest gap`,
        detail: 'High replies but low interest - messaging may need refinement'
      });
    }

    // Low performers (below 1% interest rate)
    const lowPerformingCount = campaignPerformances.filter(c => c.interestRate < 1).length;
    if (lowPerformingCount > 2) {
      insights.push({
        type: 'warning',
        emoji: '⚠️',
        headline: `${lowPerformingCount} campaigns below 1% interest`,
        detail: 'Consider A/B testing subject lines and value propositions'
      });
    }

    // Volume insight
    insights.push({
      type: 'info',
      emoji: '📊',
      headline: `${totalSent.toLocaleString()} emails → ${totalInterested} interested`,
      detail: `${((totalInterested / totalSent) * 100).toFixed(2)}% overall interest rate`
    });

    // Next step recommendation
    const avgInterest = campaignPerformances.reduce((s, c) => s + c.interestRate, 0) / campaignPerformances.length;
    insights.push({
      type: 'next_step',
      emoji: '🚀',
      headline: avgInterest < 1.5 ? 'Test pain-first messaging' : 'Scale winning campaigns',
      detail: avgInterest < 1.5
        ? 'Low overall interest - try more specific, problem-focused subjects'
        : 'Strong interest rates - increase volume on top performers'
    });

    // Build report
    const report: PerformanceReport = {
      workspaceName,
      cycleNumber: 1,
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      }),
      endDate: new Date().toLocaleDateString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
      }),
      heroMetrics: {
        totalCampaigns,
        leadsContacted: totalLeadsContacted,
        messagesSent: totalSent,
        avgResponseRate: parseFloat(avgResponseRate.toFixed(1)),
        emailPositives: totalInterested, // Sum from campaign stats (authoritative)
      },
      campaigns: campaignPerformances,
      copyAnalysis: {
        ...copyAnalysis,
        body: bodyAnalysis,
        cta: ctaAnalysis,
      },
      interestedLeads,
      filters: {
        campaigns: uniqueCampaigns,
        industries: uniqueIndustries,
      },
      insights,
    };

    return NextResponse.json({ data: report });
  } catch (error) {
    console.error('Report generation error:', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
