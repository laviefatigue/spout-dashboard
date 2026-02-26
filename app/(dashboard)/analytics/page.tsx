'use client';

import { useEffect, useState, useMemo } from 'react';
import { PageContainer } from '@/components/layout';
import { Skeleton } from '@/components/ui/skeleton';
import type {
  AnalyticsReport,
  AnalyzedReply,
  ReplySentiment,
  DemographicDistribution,
} from '@/lib/types/emailbison';
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
} from 'lucide-react';

// --- Utility Components ---

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

// --- Bar Chart Component ---

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

// --- Sentiment Donut ---

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

// --- Lead Deep-Dive Table ---

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
      {/* Header */}
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
            <select
              value={sentimentFilter}
              onChange={(e) => setSentimentFilter(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="">All Sentiments</option>
              <option value="positive">Positive</option>
              <option value="negative">Negative</option>
              <option value="neutral">Neutral</option>
            </select>
            <select
              value={industryFilter}
              onChange={(e) => setIndustryFilter(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="">All Industries</option>
              {industries.map(i => <option key={i} value={i}>{i}</option>)}
            </select>
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="h-8 px-3 text-xs rounded-lg border bg-background"
            >
              <option value="">All Campaigns</option>
              {campaigns.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {(sentimentFilter || industryFilter || campaignFilter) && (
              <button
                onClick={() => { setSentimentFilter(''); setIndustryFilter(''); setCampaignFilter(''); }}
                className="h-8 px-3 text-xs rounded-lg border bg-red-50 text-red-600 hover:bg-red-100"
              >
                Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Table */}
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
                  <td className="py-3 px-4">
                    <SentimentBadge sentiment={reply.sentiment} />
                  </td>
                  <td className="py-3 px-4">
                    <IntentBadge intent={reply.intent} />
                  </td>
                  <td className="py-3 px-4">
                    <p className="text-xs text-muted-foreground truncate max-w-[120px]" title={reply.campaignName}>
                      {reply.campaignName}
                    </p>
                  </td>
                  <td className="py-3 px-4 max-w-[200px]">
                    <p className="text-xs text-muted-foreground line-clamp-2">{reply.summary}</p>
                  </td>
                </tr>
                {expandedId === reply.replyId && (
                  <tr key={`${reply.replyId}-exp`} className="bg-muted/20">
                    <td colSpan={7} className="p-6">
                      <div className="space-y-4">
                        {/* Reply Content */}
                        <div className="bg-card rounded-lg border p-4">
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Full Reply</p>
                          <p className="text-sm text-foreground whitespace-pre-wrap bg-muted/30 rounded-lg p-3 max-h-48 overflow-y-auto">
                            {reply.replyText || 'No reply text available'}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Subject: {reply.subject} | Date: {new Date(reply.replyDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                          </p>
                        </div>

                        {/* AI Analysis */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          {reply.buyingSignals.length > 0 && (
                            <div className="bg-emerald-50 dark:bg-emerald-950/20 rounded-lg p-3 border border-emerald-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <Sparkles className="h-3 w-3 text-emerald-600" />
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase">Buying Signals</p>
                              </div>
                              <ul className="space-y-1">
                                {reply.buyingSignals.map((s, i) => (
                                  <li key={i} className="text-xs text-emerald-600">{s}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {reply.objections.length > 0 && (
                            <div className="bg-red-50 dark:bg-red-950/20 rounded-lg p-3 border border-red-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <AlertTriangle className="h-3 w-3 text-red-600" />
                                <p className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase">Objections</p>
                              </div>
                              <ul className="space-y-1">
                                {reply.objections.map((o, i) => (
                                  <li key={i} className="text-xs text-red-600">{o}</li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {reply.themes.length > 0 && (
                            <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-3 border border-blue-500/20">
                              <div className="flex items-center gap-1 mb-2">
                                <MessageSquare className="h-3 w-3 text-blue-600" />
                                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 uppercase">Themes</p>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {reply.themes.map((t, i) => (
                                  <span key={i} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Lead Details */}
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

// --- Main Page ---

export default function AnalyticsPage() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const response = await fetch('/api/analytics');
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const { data } = await response.json();
        setReport(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <PageContainer className="space-y-8">
        <Skeleton className="h-64 w-full rounded-3xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-80 w-full" />
        </div>
        <Skeleton className="h-96 w-full" />
      </PageContainer>
    );
  }

  if (error || !report) {
    return (
      <PageContainer className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <p className="text-destructive font-medium">{error || 'No data available'}</p>
        </div>
      </PageContainer>
    );
  }

  const positiveRate = report.totalAnalyzed > 0
    ? ((report.sentimentBreakdown.positive / report.totalAnalyzed) * 100).toFixed(0)
    : '0';

  const topIndustry = report.industryDistribution[0]?.label || 'N/A';
  const interestedCount = report.replies.filter(r => r.isInterested).length;

  return (
    <PageContainer className="space-y-8 pb-12">
      {/* Hero Section */}
      <div className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 text-white rounded-3xl p-8 shadow-xl">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <span className="text-white/80 font-medium text-sm uppercase tracking-wider">
              RESPONSE ANALYTICS
            </span>
            <h1 className="text-3xl font-bold">{report.workspaceName}</h1>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <MessageSquare className="h-4 w-4 text-white/70" />
              <span className="text-white/70 text-sm">Replies Analyzed</span>
            </div>
            <p className="text-3xl font-bold">{report.totalAnalyzed}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <ThumbsUp className="h-4 w-4 text-white/70" />
              <span className="text-white/70 text-sm">Positive Rate</span>
            </div>
            <p className="text-3xl font-bold">{positiveRate}%</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-white/70" />
              <span className="text-white/70 text-sm">Interested</span>
            </div>
            <p className="text-3xl font-bold">{interestedCount}</p>
          </div>
          <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-5 border border-white/20">
            <div className="flex items-center gap-2 mb-1">
              <Building2 className="h-4 w-4 text-white/70" />
              <span className="text-white/70 text-sm">Top Vertical</span>
            </div>
            <p className="text-2xl font-bold">{topIndustry}</p>
          </div>
        </div>
      </div>

      {/* Response Intelligence */}
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-4 flex items-center gap-2">
          <Brain className="h-6 w-6 text-violet-600" />
          Response Intelligence
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Sentiment Breakdown */}
          <div className="rounded-lg border bg-card shadow-sm p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Sentiment Breakdown</h3>
            <SentimentOverview breakdown={report.sentimentBreakdown} total={report.totalAnalyzed} />
          </div>

          {/* Key Themes */}
          <div className="rounded-lg border bg-card shadow-sm p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">Top Themes</h3>
            {report.topThemes.length > 0 ? (
              <div className="space-y-2">
                {report.topThemes.map((t) => (
                  <div key={t.theme} className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">{t.theme}</span>
                    <span className="text-sm text-muted-foreground">{t.count} replies</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No themes extracted yet</p>
            )}
          </div>

          {/* Buying Signals */}
          {report.topBuyingSignals.length > 0 && (
            <div className="rounded-lg border bg-card shadow-sm p-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-emerald-600" />
                Buying Signals
              </h3>
              <div className="space-y-2">
                {report.topBuyingSignals.map((s) => (
                  <div key={s.signal} className="flex items-center justify-between">
                    <span className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{s.signal}</span>
                    <span className="text-sm text-muted-foreground">{s.count}x</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common Objections */}
          {report.topObjections.length > 0 && (
            <div className="rounded-lg border bg-card shadow-sm p-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                Common Objections
              </h3>
              <div className="space-y-2">
                {report.topObjections.map((o) => (
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
          {/* Industry Distribution */}
          <div className="rounded-lg border bg-card shadow-sm p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Industry Distribution
            </h3>
            <HorizontalBarChart
              data={report.industryDistribution}
              colorClass="bg-indigo-600"
              showInterested
            />
          </div>

          {/* Seniority Distribution */}
          <div className="rounded-lg border bg-card shadow-sm p-6">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Briefcase className="h-4 w-4" />
              Title Seniority
            </h3>
            <HorizontalBarChart
              data={report.seniorityDistribution}
              colorClass="bg-purple-600"
              showInterested
            />
          </div>

          {/* Top Companies */}
          <div className="rounded-lg border bg-card shadow-sm p-6 lg:col-span-2">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
              <Building2 className="h-4 w-4" />
              Top Responding Companies
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {report.topCompanies.slice(0, 12).map((c) => (
                <div key={c.label} className="flex items-center justify-between p-3 rounded-lg bg-muted/50 border">
                  <span className="text-sm font-medium truncate max-w-[150px]" title={c.label}>{c.label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{c.count} {c.count === 1 ? 'reply' : 'replies'}</span>
                    {c.interestedCount > 0 && (
                      <span className="text-xs text-emerald-600 font-medium bg-emerald-50 dark:bg-emerald-950/30 px-1.5 py-0.5 rounded">
                        interested
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Lead Deep-Dive */}
      <div>
        <h2 className="text-2xl font-bold text-foreground mb-4">Lead Deep-Dive</h2>
        <LeadDeepDive
          replies={report.replies}
          industries={report.industries}
          campaigns={report.campaigns}
        />
      </div>
    </PageContainer>
  );
}
