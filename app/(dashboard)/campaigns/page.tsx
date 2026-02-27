'use client';

import { useEffect, useState } from 'react';
import { Loader2, Users, Mail, TrendingUp, MessageSquare } from 'lucide-react';
import { PageContainer } from '@/components/layout';
import type { FastAnalytics, CampaignComparisonItem } from '@/lib/types/emailbison';
import { toast } from 'sonner';

export default function CampaignsPage() {
  const [fastData, setFastData] = useState<FastAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/analytics/fast');
        if (!response.ok) throw new Error('Failed to fetch analytics');
        const json = await response.json();
        setFastData(json.data);
      } catch (error) {
        console.error('Error fetching campaigns:', error);
        toast.error('Failed to load campaigns');
      } finally {
        setIsLoading(false);
      }
    };

    fetchData();
  }, []);

  if (isLoading || !fastData) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PageContainer>
    );
  }

  const { heroMetrics, campaignComparison } = fastData;

  return (
    <PageContainer className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Campaigns</h2>
        <p className="text-muted-foreground">
          {heroMetrics.activeCampaigns} active campaigns
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Mail className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{heroMetrics.activeCampaigns}</p>
              <p className="text-sm text-muted-foreground">Campaigns</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-selery-cyan/10 flex items-center justify-center">
              <Users className="h-5 w-5 text-selery-cyan" />
            </div>
            <div>
              <p className="text-2xl font-bold">{heroMetrics.leadsContacted.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Leads Contacted</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-selery-navy/10 flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-selery-navy" />
            </div>
            <div>
              <p className="text-2xl font-bold">{heroMetrics.emailsSent.toLocaleString()}</p>
              <p className="text-sm text-muted-foreground">Emails Sent</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{heroMetrics.totalInterested}</p>
              <p className="text-sm text-muted-foreground">Interested</p>
            </div>
          </div>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
            </div>
            <div>
              <p className="text-2xl font-bold">{heroMetrics.avgReplyRate}%</p>
              <p className="text-sm text-muted-foreground">Response Rate</p>
            </div>
          </div>
        </div>
      </div>

      {/* Campaign Table */}
      <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="h-10 px-4 text-left font-medium text-muted-foreground text-xs uppercase">Campaign</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Sent</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Contacted</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Reply %</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Interest %</th>
                <th className="h-10 px-4 text-right font-medium text-muted-foreground text-xs uppercase">Interested</th>
              </tr>
            </thead>
            <tbody>
              {campaignComparison.map((c: CampaignComparisonItem) => (
                <tr key={c.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.status === 'Active' ? 'bg-emerald-500' : 'bg-gray-400'}`} />
                      <span className="font-medium text-foreground truncate max-w-[250px]" title={c.name}>{c.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{c.emailsSent.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right text-muted-foreground">{c.leadsContacted.toLocaleString()}</td>
                  <td className="py-3 px-4 text-right font-medium">{c.replyRate}%</td>
                  <td className="py-3 px-4 text-right font-bold">{c.interestRate}%</td>
                  <td className="py-3 px-4 text-right text-blue-600 font-medium">{c.interested}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageContainer>
  );
}
