'use client';

import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { PageContainer } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AnalyticsReport,
  AnalyzedReply,
  ReplySentiment,
  ReplyIntent,
  DemographicDistribution,
  FastAnalytics,
  SenderAnalytics,
  CampaignComparisonItem,
  SequenceStepPerformance,
  DomainStats,
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
} from 'lucide-react';

// ── Utility Components ────────────────────────────────────────────────

function SentimentBadge({ sentiment }: { sentiment: ReplySentiment }) {
  const config = {
    positive: { label: 'Positive', bg: 'bg-emerald-100 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-400', icon: ThumbsUp },
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
    'interested': 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400',
    'not-interested': 'bg-red-100 text-red-700 dark:bg-red-950/30 dark:text-red-400',
    'needs-info': 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400',
    'referral': 'bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400',
    'out-of-office': 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    'unsubscribe': 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[intent] || colors['needs-info']}`}>
      {intent.replace(/-/g, ' ')}
    </span>
  );
}

function HorizontalBarChart({
  data,
  colorClass = 'bg-indigo-600',
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
                <span className="text-xs text-emerald-600 font-medium">
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
    { key: 'positive' as const, label: 'Positive', color: 'bg-emerald-500', count: breakdown.positive },
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
    { label: 'Total Leads', value: funnel.totalLeads, color: 'from-slate-500 to-slate-600' },
    { label: 'Contacted', value: funnel.contacted, color: 'from-blue-500 to-blue-600' },
    { label: 'Replied', value: funnel.replied, color: 'from-violet-500 to-violet-600' },
    { label: 'Interested', value: funnel.interested, color: 'from-emerald-500 to-emerald-600' },
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

function CampaignComparison({ campaigns }: { campaigns: CampaignComparisonItem[] }) {
  if (campaigns.length === 0) return null;

  const bestInterest = Math.max(...campaigns.map(c => c.interestRate));

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <div className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 border-b">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          Campaign Comparison
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/30">
              <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Campaign</th>
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
              <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                    <span className="font-medium text-foreground truncate max-w-[200px]" title={c.name}>
                      {c.name.replace(/^Cycle \d+:\s*/, '').replace(/^Campaign \d+,\s*/, '')}
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right text-muted-foreground">{c.emailsSent.toLocaleString()}</td>
                <td className="py-3 px-4 text-right text-muted-foreground">{c.leadsContacted.toLocaleString()}</td>
                <td className="py-3 px-4 text-right">
                  <span className="font-medium">{c.replyRate}%</span>
                </td>
                <td className="py-3 px-4 text-right">
                  <span className={`font-bold ${c.interestRate === bestInterest && c.interestRate > 0 ? 'text-emerald-600' : ''}`}>
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
                        className="h-full bg-indigo-500 rounded-full"
                        style={{ width: `${Math.min(c.completionPct, 100)}%` }}
                      />
                    </div>
                    <span className="text-xs text-muted-foreground w-9 text-right">{c.completionPct.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
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
                  <span className="text-xs font-medium text-emerald-600">{step.interestRate}% interest ({step.totalInterested})</span>
                )}
              </div>
            </div>
            <div className="h-3 bg-muted rounded-full overflow-hidden flex">
              <div
                className="h-full bg-indigo-500 rounded-l-full transition-all duration-500"
                style={{ width: `${(step.replyRate / maxReplyRate) * 100}%` }}
                title={`${step.replyRate}% reply rate`}
              />
              {step.interestRate > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${(step.interestRate / maxReplyRate) * 100}%` }}
                  title={`${step.interestRate}% interest rate`}
                />
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-indigo-500 rounded" /> Reply rate</div>
        <div className="flex items-center gap-1"><div className="w-3 h-3 bg-emerald-500 rounded" /> Interest rate</div>
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
      <div className="p-4 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/20 dark:to-amber-950/20 border-b">
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {data.byProvider.map((p) => (
              <div key={p.provider} className="p-3 rounded-lg bg-muted/50 border">
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{p.provider}</span>
                  <span className="text-xs text-muted-foreground">({p.accountCount} accounts)</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-lg font-bold">{p.replyRate}%</p>
                    <p className="text-xs text-muted-foreground">Reply</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold">{p.bounceRate}%</p>
                    <p className="text-xs text-muted-foreground">Bounce</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-indigo-600">{p.replied.toLocaleString()}</p>
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
                className="text-xs text-indigo-600 hover:text-indigo-700 font-medium"
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

function PipelineCompanies({
  companies,
  replies,
}: {
  companies: DemographicDistribution[];
  replies: AnalyzedReply[];
}) {
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
        <Building2 className="h-4 w-4 text-emerald-600" />
        Pipeline Companies
        <span className="text-xs font-normal">({companies.length})</span>
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {companies.map((c) => {
          const companyReplies = replies.filter(r => r.company === c.label && r.isInterested);
          const latestReply = companyReplies[0];
          return (
            <div key={c.label} className="p-3 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200/50 dark:border-emerald-800/30">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-sm truncate max-w-[180px]" title={c.label}>{c.label}</span>
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded font-medium">
                  {c.interestedCount} interested
                </span>
              </div>
              {latestReply && (
                <div className="mt-2">
                  <p className="text-xs text-muted-foreground">{latestReply.name}{latestReply.title ? ` - ${latestReply.title}` : ''}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[250px]" title={latestReply.campaignName}>
                    via {latestReply.campaignName}
                  </p>
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
      <div className="p-4 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-950/20 dark:to-purple-950/20 border-b space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-gradient-to-r from-violet-600 to-purple-600 rounded-lg flex items-center justify-center">
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
                showFilters ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
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
                className="w-48 h-9 pl-9 pr-3 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-violet-500/20"
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
              <button onClick={() => { setSentimentFilter(''); setIndustryFilter(''); setCampaignFilter(''); }} className="h-8 px-3 text-xs rounded-lg border bg-red-50 text-red-600 hover:bg-red-100">
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
                    {reply.title && <p className="text-xs text-blue-600">{reply.title}</p>}
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
                            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 border border-emerald-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <Sparkles className="h-3 w-3 text-emerald-600" />
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase">Buying Signals</p>
                              </div>
                              <ul className="space-y-1">{reply.buyingSignals.map((s, i) => <li key={i} className="text-xs text-emerald-600">{s}</li>)}</ul>
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
                            <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <MessageSquare className="h-3 w-3 text-blue-600" />
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase">Themes</p>
                              </div>
                              <div className="flex flex-wrap gap-1">{reply.themes.map((t, i) => <span key={i} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">{t}</span>)}</div>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                          <span>Email: {reply.email}</span>
                          <span>Seniority: {reply.seniority}</span>
                          <span>Industry: {reply.industry}</span>
                          {reply.isInterested && <span className="text-emerald-600 font-medium">Marked Interested</span>}
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

  const [exporting, setExporting] = useState(false);
  const [activeCycle, setActiveCycle] = useState<number | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Derive available cycles from fast data
  const availableCycles = useMemo(() => {
    return fastData?.availableCycles || [];
  }, [fastData]);

  // Parse cycle number from a campaign name
  const parseCycle = useCallback((name: string): number | null => {
    const match = name.match(/^Cycle\s+(\d+)/i);
    return match ? parseInt(match[1], 10) : null;
  }, []);

  // Filter Phase 1 data by cycle
  const filteredFastData = useMemo(() => {
    if (!fastData || activeCycle === null) return fastData;
    const filtered = fastData.campaignComparison.filter(c => parseCycle(c.name) === activeCycle);
    const emailsSent = filtered.reduce((s, c) => s + c.emailsSent, 0);
    const leadsContacted = filtered.reduce((s, c) => s + c.leadsContacted, 0);
    const totalReplies = filtered.reduce((s, c) => s + c.uniqueReplies, 0);
    const totalInterested = filtered.reduce((s, c) => s + c.interested, 0);
    return {
      ...fastData,
      heroMetrics: {
        ...fastData.heroMetrics,
        activeCampaigns: filtered.length,
        emailsSent,
        leadsContacted,
        totalReplies,
        totalInterested,
        avgReplyRate: leadsContacted > 0 ? parseFloat(((totalReplies / leadsContacted) * 100).toFixed(2)) : 0,
        avgInterestRate: leadsContacted > 0 ? parseFloat(((totalInterested / leadsContacted) * 100).toFixed(2)) : 0,
        avgBounceRate: emailsSent > 0
          ? parseFloat(((filtered.reduce((s, c) => s + Math.round(c.bounceRate * c.emailsSent / 100), 0) / emailsSent) * 100).toFixed(2))
          : 0,
      },
      funnel: {
        totalLeads: leadsContacted,
        contacted: leadsContacted,
        replied: totalReplies,
        interested: totalInterested,
      },
      campaignComparison: filtered,
    } as FastAnalytics;
  }, [fastData, activeCycle, parseCycle]);

  // Filter Phase 2 data by cycle
  const filteredReport = useMemo(() => {
    if (!report || activeCycle === null) return report;
    const filteredReplies = report.replies.filter(r => r.cycleNumber === activeCycle);
    // Recompute sentiment/intent breakdown
    const sentimentBreakdown: Record<ReplySentiment, number> = { positive: 0, negative: 0, neutral: 0 };
    const intentBreakdown: Record<ReplyIntent, number> = {
      'interested': 0, 'not-interested': 0, 'needs-info': 0,
      'referral': 0, 'out-of-office': 0, 'unsubscribe': 0,
    };
    for (const r of filteredReplies) {
      sentimentBreakdown[r.sentiment]++;
      intentBreakdown[r.intent]++;
    }
    // Recompute themes, signals, objections
    const themeCount = new Map<string, number>();
    const objCount = new Map<string, number>();
    const sigCount = new Map<string, number>();
    for (const r of filteredReplies) {
      for (const t of r.themes) themeCount.set(t, (themeCount.get(t) || 0) + 1);
      for (const o of r.objections) objCount.set(o, (objCount.get(o) || 0) + 1);
      for (const s of r.buyingSignals) sigCount.set(s, (sigCount.get(s) || 0) + 1);
    }
    // Recompute demographics
    const buildDist = (items: string[], interestedReplies: AnalyzedReply[]): DemographicDistribution[] => {
      const counts = new Map<string, number>();
      for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
      return Array.from(counts.entries())
        .map(([label, count]) => ({
          label,
          count,
          percentage: items.length > 0 ? parseFloat(((count / items.length) * 100).toFixed(1)) : 0,
          interestedCount: interestedReplies.filter(r => r.company === label || r.industry === label || r.seniority === label).filter(r => r.isInterested).length,
        }))
        .sort((a, b) => b.count - a.count);
    };
    const industries = filteredReplies.map(r => r.industry);
    const seniorities = filteredReplies.map(r => r.seniority);
    const companies = filteredReplies.map(r => r.company);
    // Pipeline companies from filtered replies
    const pipeMap = new Map<string, number>();
    for (const r of filteredReplies) {
      if (r.isInterested) pipeMap.set(r.company, (pipeMap.get(r.company) || 0) + 1);
    }
    const pipelineCompanies: DemographicDistribution[] = Array.from(pipeMap.entries())
      .map(([label, interestedCount]) => ({
        label,
        count: interestedCount,
        percentage: filteredReplies.length > 0 ? parseFloat(((interestedCount / filteredReplies.length) * 100).toFixed(1)) : 0,
        interestedCount,
      }))
      .sort((a, b) => b.interestedCount - a.interestedCount);

    return {
      ...report,
      totalAnalyzed: filteredReplies.length,
      sentimentBreakdown,
      intentBreakdown,
      industryDistribution: buildDist(industries, filteredReplies),
      seniorityDistribution: buildDist(seniorities, filteredReplies),
      topCompanies: buildDist(companies, filteredReplies).slice(0, 15),
      pipelineCompanies,
      topThemes: Array.from(themeCount.entries()).map(([theme, count]) => ({ theme, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      topObjections: Array.from(objCount.entries()).map(([objection, count]) => ({ objection, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      topBuyingSignals: Array.from(sigCount.entries()).map(([signal, count]) => ({ signal, count })).sort((a, b) => b.count - a.count).slice(0, 10),
      replies: filteredReplies,
      industries: [...new Set(industries)],
    } as AnalyticsReport;
  }, [report, activeCycle]);

  // Phase 1: Fast fetch
  useEffect(() => {
    const fetchFast = async () => {
      try {
        const [fastRes, senderRes] = await Promise.all([
          fetch('/api/analytics/fast'),
          fetch('/api/analytics/senders'),
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
  }, []);

  // Phase 2: Deep analysis (starts immediately, renders when ready)
  useEffect(() => {
    const fetchDeep = async () => {
      try {
        const response = await fetch('/api/analytics');
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
  }, []);

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
        <button onClick={handleExportCSV} disabled={!filteredReport}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border bg-white hover:bg-gray-50 text-gray-700 transition-colors disabled:opacity-50">
          <FileSpreadsheet className="h-4 w-4" /> Download CSV
        </button>
        <button onClick={handleExportPDF} disabled={exporting}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-violet-600 hover:bg-violet-700 text-white transition-colors disabled:opacity-50">
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
                  ? 'bg-violet-600 text-white border-violet-600'
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
                    ? 'bg-violet-600 text-white border-violet-600'
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
          <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 text-white rounded-3xl p-8 shadow-xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
                <Brain className="h-5 w-5" />
              </div>
              <div>
                <span className="text-white/80 font-medium text-sm uppercase tracking-wider">OUTBOUND ANALYTICS</span>
                <h1 className="text-3xl font-bold">{filteredFastData?.workspaceName || 'Selery'}{activeCycle !== null ? ` — Cycle ${activeCycle}` : ''}</h1>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
              <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-4 border border-white/20">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-4 w-4 text-white/70" />
                  <span className="text-white/70 text-xs">Campaigns</span>
                </div>
                <p className="text-2xl font-bold">{hero.activeCampaigns}</p>
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
                <Brain className="h-6 w-6 text-violet-600" />
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
                          <span className="text-sm font-medium capitalize">{t.theme}</span>
                          <span className="text-sm text-muted-foreground">{t.count} replies</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-sm text-muted-foreground">No themes extracted yet</p>}
                </div>
                {filteredReport.topBuyingSignals.length > 0 && (
                  <div className="rounded-lg border bg-card shadow-sm p-6">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-emerald-600" /> Buying Signals
                    </h3>
                    <div className="space-y-2">
                      {filteredReport.topBuyingSignals.map((s) => (
                        <div key={s.signal} className="flex items-center justify-between">
                          <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{s.signal}</span>
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
                          <span className="text-sm font-medium text-red-700 dark:text-red-400">{o.objection}</span>
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
                <BarChart3 className="h-6 w-6 text-indigo-600" />
                Who&apos;s Responding
              </h2>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Building2 className="h-4 w-4" /> Industry Distribution
                  </h3>
                  <HorizontalBarChart data={filteredReport.industryDistribution} colorClass="bg-indigo-600" showInterested />
                </div>
                <div className="rounded-lg border bg-card shadow-sm p-6">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                    <Briefcase className="h-4 w-4" /> Title Seniority
                  </h3>
                  <HorizontalBarChart data={filteredReport.seniorityDistribution} colorClass="bg-purple-600" showInterested />
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
