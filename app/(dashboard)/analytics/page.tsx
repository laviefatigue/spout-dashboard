'use client';

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { PageContainer } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AnalyticsReport,
  AnalyzedReply,
  ReplySentiment,
  DemographicDistribution,
  FastAnalytics,
  SenderAnalytics,
  CampaignComparisonItem,
  SequenceStepPerformance,
  DomainStats,
  CopyAnalysis,
} from '@/lib/types/emailbison';
import { exportPageToPDF } from '@/lib/export-pdf';
import { exportToCSV } from '@/lib/export-csv';
import {
  Brain,
  Users,
  MessageSquare,
  TrendingUp,
  Search,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  Minus,
  BarChart3,
  Building2,
  Briefcase,
  AlertTriangle,
  Sparkles,
  Filter,
  Download,
  FileSpreadsheet,
  Loader2,
  Mail,
  Globe,
  Zap,
  Target,
  ArrowRight,
  CheckCircle,
  Linkedin,
  ExternalLink,
  MapPin,
  Phone,
} from 'lucide-react';

// ── Utility Components ────────────────────────────────────────────────

// Safety net: ensure Title Case for any labels that come from the API
const toTitleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase());

function SentimentBadge({ sentiment }: { sentiment: ReplySentiment }) {
  const config = {
    positive: { label: 'Positive', bg: 'bg-selery-gold/10 dark:bg-selery-gold/20', text: 'text-selery-gold dark:text-selery-gold', icon: ThumbsUp },
    negative: { label: 'Negative', bg: 'bg-red-100 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-400', icon: ThumbsDown },
    neutral: { label: 'Neutral', bg: 'bg-gray-100 dark:bg-gray-800', text: 'text-gray-700 dark:text-gray-400', icon: Minus },
  }[sentiment];
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}

function IntentBadge({ intent }: { intent: string }) {
  const colors: Record<string, string> = {
    'interested': 'bg-selery-gold/10 text-selery-gold dark:bg-selery-gold/20 dark:text-selery-gold',
    'not-interested': 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    'needs-info': 'bg-selery-cyan/10 text-selery-cyan dark:bg-selery-cyan/20 dark:text-selery-cyan',
    'referral': 'bg-selery-navy/10 text-selery-navy dark:bg-selery-navy/20 dark:text-selery-cyan',
    'out-of-office': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    'unsubscribe': 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[intent] || colors['needs-info']}`}>
      {intent.replace(/-/g, ' ')}
    </span>
  );
}

function HorizontalBarChart({
  data,
  colorClass = 'bg-selery-cyan',
  showInterested = false,
}: {
  data: DemographicDistribution[];
  colorClass?: string;
  showInterested?: boolean;
}) {
  const maxCount = Math.max(...data.map(d => d.count), 1);
  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium text-foreground truncate max-w-[200px]" title={item.label}>
              {item.label}
            </span>
            <div className="flex items-center gap-3">
              {showInterested && item.interestedCount > 0 && (
                <span className="text-xs text-selery-gold font-medium">
                  {item.interestedCount} interested
                </span>
              )}
              <span className="text-muted-foreground text-xs">
                {item.count} ({item.percentage}%)
              </span>
            </div>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className={`h-full ${colorClass} rounded-full transition-all duration-500`}
              style={{ width: `${(item.count / maxCount) * 100}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SentimentOverview({
  breakdown,
  total,
}: {
  breakdown: Record<ReplySentiment, number>;
  total: number;
}) {
  const items = [
    { key: 'positive' as const, label: 'Positive', color: 'bg-selery-gold', count: breakdown.positive },
    { key: 'neutral' as const, label: 'Neutral', color: 'bg-gray-400', count: breakdown.neutral },
    { key: 'negative' as const, label: 'Negative', color: 'bg-red-500', count: breakdown.negative },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {items.map((item) => (
        <div key={item.key} className="text-center p-4 rounded-xl bg-muted/50 border">
          <div className={`w-3 h-3 ${item.color} rounded-full mx-auto mb-2`} />
          <p className="text-2xl font-bold text-foreground">{item.count}</p>
          <p className="text-xs text-muted-foreground">{item.label}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {total > 0 ? ((item.count / total) * 100).toFixed(0) : 0}%
          </p>
        </div>
      ))}
    </div>
  );
}

// ── Phase 1 Components (Instant) ──────────────────────────────────────

function ConversionFunnel({ funnel }: { funnel: FastAnalytics['funnel'] }) {
  const steps = [
    { label: 'Total Leads', value: funnel.totalLeads, color: 'from-gray-500 to-gray-600' },
    { label: 'Contacted', value: funnel.contacted, color: 'from-selery-cyan to-selery-cyan' },
    { label: 'Replied', value: funnel.replied, color: 'from-selery-navy to-selery-navy' },
    { label: 'Interested', value: funnel.interested, color: 'from-selery-gold to-selery-gold' },
  ];

  return (
    <div className="rounded-lg border bg-card shadow-sm p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-6 flex items-center gap-2">
        <Target className="h-4 w-4" />
        Conversion Funnel
      </h3>
      <div className="flex items-center gap-2">
        {steps.map((step, i) => {
          const prevValue = i > 0 ? steps[i - 1].value : step.value;
          const convRate = prevValue > 0 ? ((step.value / prevValue) * 100).toFixed(1) : '0';
          return (
            <div key={step.label} className="flex items-center gap-2 flex-1">
              <div className="flex-1 text-center">
                <div className={`bg-gradient-to-b ${step.color} text-white rounded-xl p-4 shadow-sm`}>
                  <p className="text-2xl font-bold">{step.value.toLocaleString()}</p>
                  <p className="text-xs text-white/80 mt-1">{step.label}</p>
                </div>
                <p className={`text-xs text-muted-foreground mt-1.5 ${i === 0 ? 'invisible' : ''}`}>
                  {i > 0 ? `${convRate}%` : '\u00A0'}
                </p>
              </div>
              {i < steps.length - 1 && (
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Sequence step interface for lazy loading
interface SequenceStep {
  id: number;
  sequence_step_id?: string;
  order: number;
  subject: string;
  body: string;
  delay_days?: number;
  delay_hours?: number;
  is_variant?: boolean;
  variant_letter?: string;
  is_thread_reply?: boolean;
  sent?: number;
  unique_replies?: number;
  reply_rate?: number;
  interested?: number;
  bounced?: number;
}

function CampaignComparison({ campaigns }: { campaigns: CampaignComparisonItem[] }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [sequenceData, setSequenceData] = useState<Record<number, SequenceStep[]>>({});
  const [seqLoading, setSeqLoading] = useState<number | null>(null);

  if (campaigns.length === 0) return null;

  const bestInterest = Math.max(...campaigns.map(c => c.interestRate));

  const handleExpand = async (campaignId: number) => {
    if (expandedId === campaignId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(campaignId);
    if (!sequenceData[campaignId]) {
      setSeqLoading(campaignId);
      try {
        const response = await fetch(`/api/emailbison/campaigns/${campaignId}/sequence`);
        if (response.ok) {
          const { data } = await response.json();
          setSequenceData(prev => ({ ...prev, [campaignId]: data || [] }));
        }
      } catch (error) {
        console.error('Failed to fetch sequence:', error);
      } finally {
        setSeqLoading(null);
      }
    }
  };

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="p-4 bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Campaign Comparison
          <span className="text-xs font-normal text-muted-foreground ml-auto">Click to expand</span>
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider w-8"></th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Campaign</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Leads</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Sent</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Contacted</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Reply %</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Interest %</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Bounce %</th>
              <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Progress</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <React.Fragment key={c.id}>
                <tr
                  className="border-b border-border/50 hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => handleExpand(c.id)}
                >
                  <td className="py-3 px-4">
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === c.id ? 'rotate-180' : ''}`} />
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status.toLowerCase() === 'active' ? 'bg-selery-gold' : 'bg-gray-400'}`} />
                      <span className={`font-medium truncate max-w-[200px] ${c.status.toLowerCase() === 'draft' ? 'text-muted-foreground' : 'text-foreground'}`} title={c.name}>
                        {c.name.replace(/^Cycle \d+:\s*/, '').replace(/^Campaign \d+,\s*/, '')}
                      </span>
                      {c.status.toLowerCase() === 'draft' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
                          {'Draft'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{c.totalLeads.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{c.emailsSent.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{c.leadsContacted.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right">
                    <span className="font-medium">{c.replyRate}%</span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={`font-bold ${c.interestRate === bestInterest && c.interestRate > 0 ? 'text-selery-gold' : ''}`}>
                      {c.interestRate}%
                    </span>
                    {c.interested > 0 && (
                      <span className="text-xs text-muted-foreground ml-1">({c.interested})</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <span className={c.bounceRate > 3 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                      {c.bounceRate}%
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-selery-cyan rounded-full"
                          style={{ width: `${Math.min(c.completionPct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-9 text-right">{c.completionPct.toFixed(0)}%</span>
                    </div>
                  </td>
                </tr>
                {expandedId === c.id && (
                  <tr className="bg-muted/30">
                    <td colSpan={9} className="p-6">
                      <div className="space-y-4">
                        {/* Stats Grid */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                          <div className="bg-card rounded-lg p-3 border">
                            <p className="text-xs text-muted-foreground mb-1">Leads Reached</p>
                            <p className="font-bold text-lg">{c.leadsContacted.toLocaleString()}</p>
                          </div>
                          <div className="bg-card rounded-lg p-3 border">
                            <p className="text-xs text-muted-foreground mb-1">Emails Sent</p>
                            <p className="font-bold text-lg">{c.emailsSent.toLocaleString()}</p>
                          </div>
                          <div className="bg-card rounded-lg p-3 border">
                            <p className="text-xs text-muted-foreground mb-1">Replies</p>
                            <p className="font-bold text-lg">{c.uniqueReplies.toLocaleString()}</p>
                          </div>
                          <div className="bg-card rounded-lg p-3 border">
                            <p className="text-xs text-muted-foreground mb-1">Interested</p>
                            <p className="font-bold text-lg text-selery-gold">{c.interested.toLocaleString()}</p>
                          </div>
                        </div>

                        {/* Email Sequence */}
                        <div className="bg-card rounded-lg border overflow-hidden">
                          <div className="bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 px-4 py-3 border-b">
                            <div className="flex items-center gap-2">
                              <Mail className="h-4 w-4 text-selery-cyan" />
                              <p className="text-sm font-semibold text-selery-navy dark:text-selery-cyan">Email Sequence</p>
                            </div>
                          </div>
                          <div className="p-4">
                            {seqLoading === c.id ? (
                              <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-6 w-6 animate-spin text-selery-cyan" />
                                <span className="ml-2 text-sm text-muted-foreground">Loading...</span>
                              </div>
                            ) : sequenceData[c.id] && sequenceData[c.id].length > 0 ? (
                              <div className="space-y-4">
                                {sequenceData[c.id].map((step, idx) => (
                                  <div key={step.id || idx} className="border rounded-lg overflow-hidden">
                                    <div className="bg-muted/50 px-4 py-2 flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-selery-cyan/10 dark:bg-selery-cyan/20 text-selery-navy dark:text-selery-cyan text-xs font-bold">
                                          {idx + 1}
                                        </span>
                                        <span className="text-sm font-medium">Step {idx + 1}</span>
                                        {step.is_variant && (
                                          <span className="text-xs bg-selery-navy/10 dark:bg-selery-navy/20 text-selery-navy dark:text-selery-cyan px-2 py-0.5 rounded">
                                            Variant {step.variant_letter || ''}
                                          </span>
                                        )}
                                        {step.is_thread_reply && (
                                          <span className="text-xs bg-selery-cyan/10 dark:bg-selery-cyan/20 text-selery-cyan dark:text-selery-cyan px-2 py-0.5 rounded">
                                            Thread Reply
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                        {step.sent !== undefined && <span>{step.sent?.toLocaleString()} sent</span>}
                                        {step.reply_rate !== undefined && <span className="font-medium text-selery-cyan">{step.reply_rate}% reply</span>}
                                        {(step.delay_days || step.delay_hours) && (
                                          <span>{step.delay_days ? `${step.delay_days}d` : ''}{step.delay_hours ? `${step.delay_hours}h` : ''} delay</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="p-4 space-y-3">
                                      <div>
                                        <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Subject</p>
                                        <p className="text-sm font-medium text-foreground">{step.subject}</p>
                                      </div>
                                      {step.body ? (
                                        <div>
                                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Body</p>
                                          <div
                                            className="text-sm text-muted-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto"
                                            dangerouslySetInnerHTML={{ __html: step.body?.replace(/\n/g, '<br/>') || '' }}
                                          />
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-4 text-sm bg-muted/30 rounded-lg p-3">
                                          {step.sent !== undefined && (
                                            <div><span className="text-muted-foreground">Sent: </span><span className="font-medium">{step.sent?.toLocaleString()}</span></div>
                                          )}
                                          {step.unique_replies !== undefined && (
                                            <div><span className="text-muted-foreground">Replies: </span><span className="font-medium text-selery-cyan">{step.unique_replies}</span></div>
                                          )}
                                          {step.interested !== undefined && (
                                            <div><span className="text-muted-foreground">Interested: </span><span className="font-medium text-selery-gold">{step.interested}</span></div>
                                          )}
                                          {step.bounced !== undefined && (
                                            <div><span className="text-muted-foreground">Bounced: </span><span className="font-medium text-red-500">{step.bounced}</span></div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-6 text-muted-foreground">
                                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm">No sequence data available</p>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Performance Summary */}
                        <div className="bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 rounded-lg p-4 border border-selery-cyan/10">
                          <div className="flex items-center gap-2 mb-2">
                            <Target className="h-4 w-4 text-selery-cyan" />
                            <p className="text-xs text-selery-cyan uppercase tracking-wider font-semibold">Performance Summary</p>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Reached <span className="font-semibold text-foreground">{c.leadsContacted.toLocaleString()}</span> leads
                            {' '}&rarr; <span className="font-semibold text-foreground">{c.uniqueReplies.toLocaleString()}</span> replied ({c.replyRate}%)
                            {' '}&rarr; <span className="font-semibold text-selery-gold">{c.interested.toLocaleString()}</span> interested ({c.interestRate}%)
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SequenceStepAnalysis({ steps }: { steps: SequenceStepPerformance[] }) {
  if (steps.length === 0) return null;

  const maxReplyRate = Math.max(...steps.map(s => s.replyRate), 1);

  return (
    <div className="rounded-lg border bg-card shadow-sm p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
        <Zap className="h-4 w-4" />
        Sequence Step Performance
        <span className="text-xs font-normal text-muted-foreground">(across {steps[0]?.campaignCount || 0} campaigns)</span>
      </h3>
      <div className="space-y-4">
        {steps.map((step) => (
          <div key={step.stepNumber} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{step.subject}</span>
              <div className="flex items-center gap-4">
                <span className="text-xs text-muted-foreground">{step.totalSent.toLocaleString()} sent</span>
                <span className="text-xs font-medium">{step.replyRate}% reply</span>
                {step.totalInterested > 0 && (
                  <span className="text-xs font-medium text-selery-gold">{step.interestRate}% interest ({step.totalInterested})</span>
                )}
              </div>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden flex">
              <div
                className="h-full bg-selery-cyan rounded-l-full transition-all duration-500"
                style={{ width: `${(step.replyRate / maxReplyRate) * 100}%` }}
                title={`${step.replyRate}% reply rate`}
              />
              {step.interestRate > 0 && (
                <div
                  className="h-full bg-selery-gold transition-all duration-500"
                  style={{ width: `${(step.interestRate / maxReplyRate) * 100}%` }}
                  title={`${step.interestRate}% interest rate`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-selery-cyan rounded" /> Reply rate</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-selery-gold rounded" /> Interest rate</div>
      </div>
    </div>
  );
}

function SenderPerformance({ data }: { data: SenderAnalytics }) {
  const [showAllDomains, setShowAllDomains] = useState(false);
  const activeDomains = data.byDomain.filter(d => d.emailsSent > 0);
  const domainsToShow = showAllDomains ? activeDomains : activeDomains.slice(0, 10);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="p-4 bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 border-b">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
            <Mail className="h-4 w-4" />
            Sender & Domain Performance
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{data.totalAccounts} accounts</span>
            <span>{data.connectedAccounts} connected</span>
          </div>
        </div>
      </div>

      {/* Provider Summary */}
      {data.byProvider.length > 0 && (
        <div className="p-4 border-b">
          <div className={`grid grid-cols-1 gap-3 ${data.byProvider.length >= 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
            {data.byProvider.map((p) => (
              <div key={p.provider} className="p-4 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-2 mb-3">
                  <Globe className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium text-sm truncate">{p.provider}</span>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">({p.accountCount})</span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div className="min-w-0">
                    <p className="text-base font-bold">{p.replyRate}%</p>
                    <p className="text-xs text-muted-foreground">Reply</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold">{p.bounceRate}%</p>
                    <p className="text-xs text-muted-foreground">Bounce</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-base font-bold text-selery-cyan">{p.replied.toLocaleString()}</p>
                    <p className="text-xs text-muted-foreground">Replied</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Domain Breakdown Table */}
      {activeDomains.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="h-9 px-4 text-left font-medium text-muted-foreground text-xs uppercase">Domain</th>
                <th className="h-9 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Accounts</th>
                <th className="h-9 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Sent</th>
                <th className="h-9 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Reply %</th>
                <th className="h-9 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Bounce %</th>
                <th className="h-9 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Replied</th>
              </tr>
            </thead>
            <tbody>
              {domainsToShow.map((d: DomainStats) => (
                <tr key={d.domain} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-2.5 px-4 font-medium">{d.domain}</td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground">{d.accountCount}</td>
                  <td className="py-2.5 px-4 text-right text-muted-foreground">{d.emailsSent.toLocaleString()}</td>
                  <td className="py-2.5 px-4 text-right font-medium">{d.replyRate}%</td>
                  <td className="py-2.5 px-4 text-right">
                    <span className={d.bounceRate > 3 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                      {d.bounceRate}%
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <span className="text-muted-foreground">{d.replied.toLocaleString()}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {activeDomains.length > 10 && (
            <div className="p-3 text-center border-t">
              <button
                onClick={() => setShowAllDomains(!showAllDomains)}
                className="text-xs text-selery-cyan hover:text-selery-cyan/80 font-medium"
              >
                {showAllDomains ? 'Show less' : `Show all ${activeDomains.length} domains`}
              </button>
            </div>
          )}
        </div>
      )}

      {activeDomains.length === 0 && (
        <div className="p-8 text-center text-muted-foreground">
          <Mail className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No sending activity yet</p>
        </div>
      )}
    </div>
  );
}

interface EnrichedContact {
  email: string;
  fullName: string | null;
  title: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  location: string | null;
  company: string | null;
  phone: string | null;
}

function PipelineCompanies({
  companies,
  replies,
}: {
  companies: DemographicDistribution[];
  replies: AnalyzedReply[];
}) {
  const [enriched, setEnriched] = useState<Record<string, EnrichedContact>>({});
  const [enrichLoading, setEnrichLoading] = useState(false);
  const enrichedRef = useRef(false);

  // Collect unique emails from pipeline companies
  const emailsToEnrich = useMemo(() => {
    const emails: string[] = [];
    for (const c of companies) {
      const companyReplies = replies.filter(r => r.company === c.label && r.isInterested);
      for (const r of companyReplies) {
        if (r.email && !emails.includes(r.email)) {
          emails.push(r.email);
        }
      }
    }
    return emails;
  }, [companies, replies]);

  // Fetch enrichment data once when pipeline companies appear
  useEffect(() => {
    if (emailsToEnrich.length === 0 || enrichedRef.current) return;
    enrichedRef.current = true;
    setEnrichLoading(true);
    fetch('/api/analytics/enrich', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emails: emailsToEnrich }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.results) {
          const map: Record<string, EnrichedContact> = {};
          for (const c of data.results as EnrichedContact[]) {
            map[c.email] = c;
          }
          setEnriched(map);
        }
      })
      .catch(() => { /* silently fail — enrichment is optional */ })
      .finally(() => setEnrichLoading(false));
  }, [emailsToEnrich]);

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border bg-card shadow-sm p-8 text-center">
        <Building2 className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No pipeline companies yet</p>
        <p className="text-xs text-muted-foreground mt-1">Companies appear here when they express interest</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm p-6">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-selery-gold" />
        Pipeline Companies
        <span className="text-xs font-normal">({companies.length})</span>
        {enrichLoading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {companies.map((c) => {
          const companyReplies = replies.filter(r => r.company === c.label && r.isInterested);
          const latestReply = companyReplies[0];
          const domain = latestReply?.email?.split('@')[1];
          const enrichData = latestReply?.email ? enriched[latestReply.email] : null;
          const hasEnrichment = enrichData && (enrichData.linkedinUrl || enrichData.phone || enrichData.location);
          return (
            <div key={c.label} className="p-3 rounded-lg bg-selery-gold/5 dark:bg-selery-gold/10 border border-selery-gold/20 dark:border-selery-gold/20">
              <div className="flex items-center justify-between mb-1">
                {domain ? (
                  <a href={`https://${domain}`} target="_blank" rel="noopener noreferrer" className="font-medium text-sm truncate max-w-[180px] text-selery-cyan hover:underline" title={c.label}>{c.label}</a>
                ) : (
                  <span className="font-medium text-sm truncate max-w-[180px]" title={c.label}>{c.label}</span>
                )}
                <span className="text-xs bg-selery-gold/10 dark:bg-selery-gold/20 text-selery-gold dark:text-selery-gold px-1.5 py-0.5 rounded font-medium">
                  {c.interestedCount} interested
                </span>
              </div>
              {latestReply && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">
                    {enrichData?.fullName || latestReply.name}
                    {(enrichData?.title || latestReply.title) ? ` - ${enrichData?.title || latestReply.title}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[250px]" title={latestReply.campaignName}>
                    via {latestReply.campaignName}
                  </p>
                </div>
              )}
              {/* Enriched contact details from AI-Ark */}
              {hasEnrichment && (
                <div className="mt-2 pt-2 border-t border-selery-gold/10 flex flex-wrap items-center gap-2">
                  {enrichData.linkedinUrl && (
                    <a
                      href={enrichData.linkedinUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-selery-cyan hover:underline"
                    >
                      <Linkedin className="h-3 w-3" />
                      LinkedIn
                    </a>
                  )}
                  {enrichData.phone && (
                    <a
                      href={`tel:${enrichData.phone}`}
                      className="inline-flex items-center gap-1 text-[11px] text-selery-cyan hover:underline"
                    >
                      <Phone className="h-3 w-3" />
                      {enrichData.phone}
                    </a>
                  )}
                  {enrichData.location && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {enrichData.location}
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Lead Deep-Dive Table (Phase 2) ───────────────────────────────────

function LeadDeepDive({
  replies,
  industries,
  campaigns,
}: {
  replies: AnalyzedReply[];
  industries: string[];
  campaigns: Array<{ id: number; name: string }>;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sentimentFilter, setSentimentFilter] = useState('');
  const [industryFilter, setIndustryFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filtered = useMemo(() => {
    return replies.filter((r) => {
      if (r.isAutomated && !r.isInterested) return false;
      if (sentimentFilter && r.sentiment !== sentimentFilter) return false;
      if (industryFilter && r.industry !== industryFilter) return false;
      if (campaignFilter && r.campaignId !== parseInt(campaignFilter)) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const fields = [r.name, r.email, r.company, r.title, r.replyText, r.industry, r.campaignName].join(' ').toLowerCase();
        return fields.includes(q);
      }
      return true;
    });
  }, [replies, searchQuery, sentimentFilter, industryFilter, campaignFilter]);

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="p-4 bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-selery-navy rounded-lg flex items-center justify-center">
              <Users className="h-4 w-4 text-white" />
            </div>
            <h3 className="text-lg font-bold">
              Lead Deep-Dive
              <span className="ml-2 text-sm font-normal text-muted-foreground">({filtered.length})</span>
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                showFilters ? 'bg-selery-cyan text-white border-selery-cyan' : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <Filter className="h-3 w-3" />
              Filters
            </button>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-48 h-9 pl-9 pr-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-selery-cyan/20"
              />
            </div>
          </div>
        </div>
        {showFilters && (
          <div className="flex flex-wrap gap-2">
            <select value={sentimentFilter} onChange={(e) => setSentimentFilter(e.target.value)} className="h-8 px-3 text-xs rounded-lg border bg-background">
              <option value="">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)} className="h-8 px-3 text-xs rounded-lg border bg-background">
              <option value="">All Industries</option>
              {industries.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select value={campaignFilter} onChange={(e) => setCampaignFilter(e.target.value)} className="h-8 px-3 text-xs rounded-lg border bg-background">
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {(sentimentFilter || industryFilter || campaignFilter) && (
              <button onClick={() => { setSentimentFilter(''); setIndustryFilter(''); setCampaignFilter(''); }} className="h-8 px-3 text-xs rounded-lg border bg-gray-100 text-gray-600 hover:bg-gray-200">
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      <div className="overflow-x-auto max-h-[700px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="border-b bg-muted/30">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider w-8"></th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Contact</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Company</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Sentiment</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Intent</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Campaign</th>
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Summary</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((reply) => (
              <>
                <tr
                  key={reply.replyId}
                  className="hover:bg-muted/30 border-b border-border/50 cursor-pointer transition-colors"
                  onClick={() => setExpandedId(expandedId === reply.replyId ? null : reply.replyId)}
                >
                  <td className="py-3 px-4">
                    <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expandedId === reply.replyId ? 'rotate-180' : ''}`} />
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-medium text-foreground">{reply.name}</p>
                    {reply.title && <p className="text-xs text-selery-cyan">{reply.title}</p>}
                  </td>
                  <td className="py-3 px-4">
                    <p className="font-medium">{reply.company}</p>
                    <p className="text-xs text-muted-foreground">{reply.industry}</p>
                  </td>
                  <td className="py-3 px-4"><SentimentBadge sentiment={reply.sentiment} /></td>
                  <td className="py-3 px-4"><IntentBadge intent={reply.intent} /></td>
                  <td className="py-3 px-4">
                    <p className="text-xs text-muted-foreground truncate max-w-[120px]" title={reply.campaignName}>{reply.campaignName}</p>
                  </td>
                  <td className="py-3 px-4 max-w-[200px]">
                    <p className="text-xs text-muted-foreground line-clamp-2">{reply.summary}</p>
                  </td>
                </tr>
                {expandedId === reply.replyId && (
                  <tr key={`${reply.replyId}-exp`} className="bg-muted/20">
                    <td colSpan={7} className="p-6">
                      <div className="space-y-4">
                        <div className="bg-card rounded-lg border p-4">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Full Reply</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {reply.replyText || 'No reply text available'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Subject: {reply.subject} | Date: {new Date(reply.replyDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {reply.buyingSignals.length > 0 && (
                            <div className="bg-selery-gold/5 dark:bg-selery-gold/10 rounded-lg p-3 border border-selery-gold/20">
                              <div className="flex items-center gap-1 mb-2">
                                <Sparkles className="h-3 w-3 text-selery-gold" />
                                <p className="text-xs font-semibold text-selery-gold dark:text-selery-gold uppercase">Buying Signals</p>
                              </div>
                              <ul className="space-y-1">{reply.buyingSignals.map((s, i) => <li key={i} className="text-xs text-selery-gold">{s}</li>)}</ul>
                            </div>
                          )}
                          {reply.objections.length > 0 && (
                            <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3 border border-red-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <AlertTriangle className="h-3 w-3 text-red-600" />
                                <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase">Objections</p>
                              </div>
                              <ul className="space-y-1">{reply.objections.map((o, i) => <li key={i} className="text-xs text-red-600">{o}</li>)}</ul>
                            </div>
                          )}
                          {reply.themes.length > 0 && (
                            <div className="bg-selery-cyan/5 dark:bg-selery-cyan/10 rounded-lg p-3 border border-selery-cyan/20">
                              <div className="flex items-center gap-1 mb-2">
                                <MessageSquare className="h-3 w-3 text-selery-cyan" />
                                <p className="text-xs font-semibold text-selery-navy dark:text-selery-cyan uppercase">Themes</p>
                              </div>
                              <div className="flex flex-wrap gap-1">{reply.themes.map((t, i) => <span key={i} className="text-xs bg-selery-cyan/10 dark:bg-selery-cyan/20 text-selery-navy dark:text-selery-cyan px-2 py-0.5 rounded">{t}</span>)}</div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Email: {reply.email}</span>
                          <span>Seniority: {reply.seniority}</span>
                          <span>Industry: {reply.industry}</span>
                          {reply.isInterested && <span className="text-selery-gold font-medium">Marked Interested</span>}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>No replies match your filters</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Phase 2 Skeleton ──────────────────────────────────────────────────

function Phase2Skeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span className="text-sm">Analyzing replies with AI...</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-60 w-full rounded-lg" />
        <Skeleton className="h-60 w-full rounded-lg" />
      </div>
      <Skeleton className="h-40 w-full rounded-lg" />
      <Skeleton className="h-96 w-full rounded-lg" />
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  // Phase 1: Fast data
  const [fastData, setFastData] = useState<FastAnalytics | null>(null);
  const [senderData, setSenderData] = useState<SenderAnalytics | null>(null);
  const [phase1Loading, setPhase1Loading] = useState(true);
  const [phase1Error, setPhase1Error] = useState<string | null>(null);

  // Phase 2: Deep analysis
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [phase2Loading, setPhase2Loading] = useState(true);
  const [phase2Error, setPhase2Error] = useState<string | null>(null);

  // Phase 3: Copy analysis
  const [copyData, setCopyData] = useState<CopyAnalysis | null>(null);
  const [phase3Loading, setPhase3Loading] = useState(true);

  const [exporting, setExporting] = useState(false);
  const [activeCycle, setActiveCycle] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Derive available cycles from fast data
  const availableCycles = useMemo(() => {
    return fastData?.availableCycles || [];
  }, [fastData]);

  // Server-side now handles cycle filtering — pass data through directly
  const filteredFastData = fastData;
  const filteredReport = report;

  // Build query string for cycle + refresh
  const buildQuery = useCallback((refresh = false) => {
    const params = new URLSearchParams();
    if (activeCycle !== null) params.set('cycle', String(activeCycle));
    if (refresh) params.set('refresh', 'true');
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [activeCycle]);

  // Phase 1: Fast fetch (re-fetches on cycle change)
  useEffect(() => {
    const fetchFast = async () => {
      setPhase1Loading(true);
      try {
        const query = activeCycle !== null ? `?cycle=${activeCycle}` : '';
        const [fastRes, senderRes] = await Promise.all([
          fetch(`/api/analytics/fast${query}`),
          fetch(`/api/analytics/senders${query}`),
        ]);
        if (fastRes.ok) {
          const { data } = await fastRes.json();
          setFastData(data);
        }
        if (senderRes.ok) {
          const { data } = await senderRes.json();
          setSenderData(data);
        }
      } catch (err) {
        setPhase1Error(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        setPhase1Loading(false);
      }
    };
    fetchFast();
  }, [activeCycle]);

  // Phase 2: Deep analysis (re-fetches on cycle change)
  useEffect(() => {
    const fetchDeep = async () => {
      setPhase2Loading(true);
      try {
        const query = activeCycle !== null ? `?cycle=${activeCycle}` : '';
        const response = await fetch(`/api/analytics${query}`);
        if (!response.ok) throw new Error('Failed to fetch deep analytics');
        const { data } = await response.json();
        setReport(data);
      } catch (err) {
        setPhase2Error(err instanceof Error ? err.message : 'Failed to load reply analysis');
      } finally {
        setPhase2Loading(false);
      }
    };
    fetchDeep();
  }, [activeCycle]);

  // Phase 3: Copy analysis (re-fetches on cycle change)
  useEffect(() => {
    const fetchCopy = async () => {
      setPhase3Loading(true);
      try {
        const query = activeCycle !== null ? `?cycle=${activeCycle}` : '';
        const response = await fetch(`/api/analytics/copy${query}`);
        if (response.ok) {
          const { data } = await response.json();
          setCopyData(data);
        }
      } catch {
        // Copy analysis is optional — fail silently
      } finally {
        setPhase3Loading(false);
      }
    };
    fetchCopy();
  }, [activeCycle]);

  // Refresh handler — clears caches and re-fetches
  const handleRefresh = useCallback(async () => {
    const query = buildQuery(true);
    setPhase1Loading(true);
    setPhase2Loading(true);
    setPhase3Loading(true);
    try {
      const [fastRes, senderRes, deepRes, copyRes] = await Promise.all([
        fetch(`/api/analytics/fast${query}`),
        fetch(`/api/analytics/senders${query}`),
        fetch(`/api/analytics${query}`),
        fetch(`/api/analytics/copy${query}`),
      ]);
      if (fastRes.ok) { const { data } = await fastRes.json(); setFastData(data); }
      if (senderRes.ok) { const { data } = await senderRes.json(); setSenderData(data); }
      if (deepRes.ok) { const { data } = await deepRes.json(); setReport(data); }
      if (copyRes.ok) { const { data } = await copyRes.json(); setCopyData(data); }
    } catch {
      // individual errors handled by display
    } finally {
      setPhase1Loading(false);
      setPhase2Loading(false);
      setPhase3Loading(false);
    }
  }, [buildQuery]);

  const handleExportPDF = useCallback(async () => {
    if (!contentRef.current || exporting) return;
    setExporting(true);
    try {
      const date = new Date().toISOString().split('T')[0];
      await exportPageToPDF(contentRef.current, `Selery-Analytics-Report-${date}.pdf`, {
        title: 'Response Analytics',
        subtitle: fastData?.workspaceName || 'Selery Fulfillment',
      });
    } finally {
      setExporting(false);
    }
  }, [exporting, fastData]);

  const handleExportCSV = useCallback(() => {
    const data = filteredReport;
    if (!data) return;
    const rows = data.replies
      .filter((r) => !r.isAutomated || r.isInterested)
      .map((r) => ({
        Name: r.name, Email: r.email, Company: r.company, Title: r.title || '',
        Industry: r.industry, Seniority: r.seniority, Sentiment: r.sentiment,
        Intent: r.intent, Campaign: r.campaignName, Summary: r.summary || '',
        'Buying Signals': r.buyingSignals.join('; '), Objections: r.objections.join('; '),
        Themes: r.themes.join('; '), 'Reply Date': r.replyDate, Interested: r.isInterested ? 'Yes' : 'No',
      }));
    const cycleSuffix = activeCycle !== null ? `-Cycle${activeCycle}` : '';
    const date = new Date().toISOString().split('T')[0];
    exportToCSV(rows, `Selery-Analyzed-Replies${cycleSuffix}-${date}.csv`);
  }, [filteredReport, activeCycle]);

  // Full loading state (only if Phase 1 hasn't loaded yet)
  if (phase1Loading) {
    return (
      <PageContainer className="space-y-8">
        <Skeleton className="h-48 w-full rounded-3xl" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    );
  }

  if (phase1Error && !fastData) {
    return (
      <PageContainer className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <p className="text-destructive font-medium">{phase1Error}</p>
        </div>
      </PageContainer>
    );
  }

  const hero = filteredFastData?.heroMetrics;

  return (
    <PageContainer className="space-y-8 pb-12">
      {/* Export Buttons */}
      <div className="flex items-center justify-end gap-3 hide-on-export">
        <button onClick={handleRefresh} disabled={phase1Loading && phase2Loading}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50">
          {(phase1Loading || phase2Loading) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Refresh Data
        </button>
        <button onClick={handleExportCSV} disabled={!filteredReport}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50">
          <FileSpreadsheet className="h-4 w-4" /> Download CSV
        </button>
        <button onClick={handleExportPDF} disabled={exporting}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-selery-cyan hover:bg-selery-cyan/80 text-white transition-colors disabled:opacity-50">
          {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {exporting ? 'Generating...' : 'Export PDF'}
        </button>
      </div>

      <div ref={contentRef} className="space-y-8">

        {/* ── Cycle Tabs ──────────────────────────────────────────── */}
        {availableCycles.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 hide-on-export">
            <button
              onClick={() => setActiveCycle(null)}
              className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                activeCycle === null
                  ? 'bg-selery-cyan text-white border-selery-cyan'
                  : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-border'
              }`}
            >
              All Cycles
            </button>
            {availableCycles.map(cycle => (
              <button
                key={cycle}
                onClick={() => setActiveCycle(cycle)}
                className={`px-4 py-2 text-sm font-medium rounded-lg border transition-colors whitespace-nowrap ${
                  activeCycle === cycle
                    ? 'bg-selery-cyan text-white border-selery-cyan'
                    : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border-border'
                }`}
              >
                Cycle {cycle}
              </button>
            ))}
          </div>
        )}

        {/* ── PHASE 1: Hero Section ─────────────────────────────── */}
        {hero && (
          <div className="bg-selery-navy text-white rounded-3xl p-8 shadow-xl">
            <div className="flex items-center gap-4 mb-6">
              <img src="/selery-logo.png" alt="Selery" className="h-10 object-contain" />
              <div className="h-8 w-px bg-white/30" />
              <div>
                <span className="text-white/80 font-medium text-sm uppercase tracking-wider">OUTBOUND ANALYTICS</span>
                <h1 className="text-3xl font-bold">{activeCycle !== null ? `Cycle ${activeCycle}` : 'All Cycles'}</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Campaigns</span>
                </div>
                <p className="text-2xl font-bold">{hero.totalCampaigns}</p>
                <p className="text-xs text-white/60">{hero.activeCampaigns} sending</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <Mail className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Emails Sent</span>
                </div>
                <p className="text-2xl font-bold">{hero.emailsSent.toLocaleString()}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <Users className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Contacted</span>
                </div>
                <p className="text-2xl font-bold">{hero.leadsContacted.toLocaleString()}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <MessageSquare className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Reply Rate</span>
                </div>
                <p className="text-2xl font-bold">{hero.avgReplyRate}%</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingUp className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Interested</span>
                </div>
                <p className="text-2xl font-bold">{hero.totalInterested}</p>
              </div>
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <Target className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Interest Rate</span>
                </div>
                <p className="text-2xl font-bold">{hero.avgInterestRate}%</p>
              </div>
            </div>
          </div>
        )}

        {/* ── PHASE 1: Conversion Funnel ────────────────────────── */}
        {filteredFastData && <ConversionFunnel funnel={filteredFastData.funnel} />}

        {/* ── PHASE 1: Campaign Comparison ──────────────────────── */}
        {filteredFastData && <CampaignComparison campaigns={filteredFastData.campaignComparison} />}

        {/* ── PHASE 1: Sequence Step + Sender side-by-side ──────── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {fastData && <SequenceStepAnalysis steps={fastData.sequenceStepPerformance} />}
          {senderData && <SenderPerformance data={senderData} />}
        </div>

        {/* ── Copy Analysis (Phase 3) ─────────────────────────── */}
        {phase3Loading ? (
          <div className="flex items-center gap-3 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Analyzing email copy...</span>
          </div>
        ) : copyData?.subjects?.analysis ? (
          <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
            <div className="flex flex-col space-y-1.5 p-6 bg-gradient-to-r from-selery-cyan/5 to-selery-navy/5 dark:from-selery-cyan/10 dark:to-selery-navy/10 border-b">
              <h2 className="flex items-center gap-3 text-xl font-bold">
                <div className="w-8 h-8 bg-selery-navy rounded-lg flex items-center justify-center">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                Copy Analysis
              </h2>
              <p className="text-muted-foreground">
                Insights from {copyData.summary.totalCampaignsAnalyzed} campaigns
              </p>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-selery-cyan/5 dark:bg-selery-cyan/10 p-4 rounded-xl border border-selery-cyan/20">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare className="h-4 w-4 text-selery-cyan" />
                    <h4 className="font-semibold text-selery-navy dark:text-selery-cyan text-sm">Subject Lines</h4>
                  </div>
                  <p className="text-sm text-selery-navy/80 dark:text-selery-cyan/80">
                    {copyData.subjects.analysis.keyInsight}
                  </p>
                </div>
                {copyData.body?.analysis && (
                  <div className="bg-selery-cyan/5 dark:bg-selery-cyan/10 p-4 rounded-xl border border-selery-cyan/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="h-4 w-4 text-selery-cyan" />
                      <h4 className="font-semibold text-selery-navy dark:text-selery-cyan text-sm">Opening Hooks</h4>
                    </div>
                    <p className="text-sm text-selery-navy/80 dark:text-selery-cyan/80">
                      {copyData.body.analysis.contrast}
                    </p>
                  </div>
                )}
                {copyData.cta?.analysis && (
                  <div className="bg-selery-cyan/5 dark:bg-selery-cyan/10 p-4 rounded-xl border border-selery-cyan/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Mail className="h-4 w-4 text-selery-cyan" />
                      <h4 className="font-semibold text-selery-navy dark:text-selery-cyan text-sm">CTAs</h4>
                    </div>
                    <p className="text-sm text-selery-navy/80 dark:text-selery-cyan/80">
                      {copyData.cta.analysis.commitmentAnalysis}
                    </p>
                  </div>
                )}
              </div>

              {/* Performance Highlight */}
              {filteredFastData && (
                <div className="bg-selery-navy p-5 rounded-xl text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-white/80 text-sm mb-1">Performance Summary</p>
                      <p className="font-semibold">
                        {filteredFastData.heroMetrics.leadsContacted.toLocaleString()} leads contacted across {filteredFastData.heroMetrics.activeCampaigns} campaigns
                        with {filteredFastData.heroMetrics.avgReplyRate}% average response rate.
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-3xl font-bold">{filteredFastData.heroMetrics.totalInterested}</p>
                      <p className="text-white/70 text-sm">interested leads</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : null}

        {/* ── PHASE 2: AI-Powered Analysis ──────────────────────── */}
        {phase2Loading ? (
          <Phase2Skeleton />
        ) : phase2Error ? (
          <div className="rounded-lg border bg-card shadow-sm p-8 text-center">
            <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-muted-foreground opacity-50" />
            <p className="text-sm text-muted-foreground">Reply analysis unavailable</p>
            <p className="text-xs text-muted-foreground mt-1">{phase2Error}</p>
          </div>
        ) : filteredReport ? (
          <>
            {/* Response Intelligence */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
                <Brain className="h-6 w-6 text-selery-cyan" />
                Response Intelligence
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Sentiment Breakdown</h3>
                  <SentimentOverview breakdown={filteredReport.sentimentBreakdown} total={filteredReport.totalAnalyzed} />
                </div>
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Themes</h3>
                  {filteredReport.topThemes.length > 0 ? (
                    <div className="space-y-2">
                      {filteredReport.topThemes.map((t) => (
                        <div key={t.theme} className="flex items-center justify-between">
                          <span className="text-sm font-medium">{toTitleCase(t.theme)}</span>
                          <span className="text-sm text-muted-foreground">{t.count} replies</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No themes extracted yet</p>}
                </div>
                {filteredReport.topBuyingSignals.length > 0 && (
                  <div className="rounded-lg border bg-card shadow-sm p-6">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-selery-gold" /> Buying Signals
                    </h3>
                    <div className="space-y-2">
                      {filteredReport.topBuyingSignals.map((s) => (
                        <div key={s.signal} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-selery-gold dark:text-selery-gold">{toTitleCase(s.signal)}</span>
                          <span className="text-sm text-muted-foreground">{s.count}x</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {filteredReport.topObjections.length > 0 && (
                  <div className="rounded-lg border bg-card shadow-sm p-6">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-red-600" /> Common Objections
                    </h3>
                    <div className="space-y-2">
                      {filteredReport.topObjections.map((o) => (
                        <div key={o.objection} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-red-700 dark:text-red-400">{toTitleCase(o.objection)}</span>
                          <span className="text-sm text-muted-foreground">{o.count}x</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Who's Responding */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
                <BarChart3 className="h-6 w-6 text-selery-cyan" />
                Who&apos;s Responding
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Industry Distribution
                  </h3>
                  <HorizontalBarChart data={filteredReport.industryDistribution} colorClass="bg-selery-cyan" showInterested />
                </div>
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" /> Title Seniority
                  </h3>
                  <HorizontalBarChart data={filteredReport.seniorityDistribution} colorClass="bg-selery-navy" showInterested />
                </div>

                {/* Pipeline Companies (replaces Top Responding Companies) */}
                <div className="lg:col-span-2">
                  <PipelineCompanies
                    companies={filteredReport.pipelineCompanies || []}
                    replies={filteredReport.replies}
                  />
                </div>
              </div>
            </div>

            {/* Lead Deep-Dive */}
            <div>
              <h2 className="text-2xl font-bold text-foreground mb-4">Lead Deep-Dive</h2>
              <LeadDeepDive replies={filteredReport.replies} industries={filteredReport.industries} campaigns={filteredReport.campaigns} />
            </div>
          </>
        ) : null}

      </div>{/* end contentRef */}
    </PageContainer>
  );
}
