// EmailBison API Client
// This runs server-side and proxies requests to the EmailBison API

const EMAILBISON_API_URL = process.env.EMAILBISON_API_URL || 'https://spellcast.hirecharm.com';
const EMAILBISON_API_TOKEN = process.env.EMAILBISON_API_TOKEN || '';

interface FetchOptions {
  method?: string;
  body?: unknown;
}

async function fetchApi<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { method = 'GET', body } = options;

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${EMAILBISON_API_TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };

  const response = await fetch(`${EMAILBISON_API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth / Account
export async function getUser() {
  return fetchApi<{ data: import('@/lib/types/emailbison').User }>('/api/users');
}

// Campaigns
export async function getCampaigns(filters?: { search?: string; status?: string }) {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);

  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<{ data: import('@/lib/types/emailbison').Campaign[] }>(`/api/campaigns${query}`);
}

export async function getCampaign(campaignId: number) {
  return fetchApi<{ data: import('@/lib/types/emailbison').Campaign }>(`/api/campaigns/${campaignId}`);
}

export async function getCampaignStats(campaignId: number, startDate: string, endDate: string) {
  return fetchApi<{ data: import('@/lib/types/emailbison').CampaignStats }>(
    `/api/campaigns/${campaignId}/stats`,
    {
      method: 'POST',
      body: { start_date: startDate, end_date: endDate }
    }
  );
}

export async function getCampaignChartStats(campaignId: number, startDate: string, endDate: string) {
  return fetchApi<{ data: import('@/lib/types/emailbison').ChartDataSeries[] }>(
    `/api/campaigns/${campaignId}/line-area-chart-stats?start_date=${startDate}&end_date=${endDate}`
  );
}

export async function getCampaignReplies(campaignId: number, filters?: {
  search?: string;
  status?: string;
  folder?: string;
  read?: boolean;
}) {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);
  if (filters?.folder) params.set('folder', filters.folder);
  if (filters?.read !== undefined) params.set('read', String(filters.read));

  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<{ data: import('@/lib/types/emailbison').Reply[] }>(
    `/api/campaigns/${campaignId}/replies${query}`
  );
}

export async function getCampaignLeads(campaignId: number, filters?: {
  search?: string;
}) {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);

  const query = params.toString() ? `?${params.toString()}` : '';
  return fetchApi<{ data: import('@/lib/types/emailbison').Lead[] }>(
    `/api/campaigns/${campaignId}/leads${query}`
  );
}

export async function getCampaignSenderEmails(campaignId: number) {
  return fetchApi<{ data: import('@/lib/types/emailbison').SenderEmail[] }>(
    `/api/campaigns/${campaignId}/sender-emails`
  );
}

// Campaigns — paginated fetch all (follows getAllSenderEmails pattern)
export async function getAllCampaigns(filters?: { search?: string; status?: string }): Promise<import('@/lib/types/emailbison').Campaign[]> {
  type Page = {
    data: import('@/lib/types/emailbison').Campaign[];
    meta?: { last_page: number; current_page: number };
  };

  const params = new URLSearchParams();
  params.set('page', '1');
  params.set('per_page', '100');
  if (filters?.search) params.set('search', filters.search);
  if (filters?.status) params.set('status', filters.status);

  const page1 = await fetchApi<Page>(`/api/campaigns?${params.toString()}`);
  const all = [...(page1.data || [])];
  const lastPage = page1.meta?.last_page || 1;

  if (lastPage > 1) {
    const pages = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
    const results = await Promise.all(
      pages.map(async (p) => {
        try {
          const pageParams = new URLSearchParams(params.toString());
          pageParams.set('page', String(p));
          const res = await fetchApi<Page>(`/api/campaigns?${pageParams.toString()}`);
          return res.data || [];
        } catch {
          return [];
        }
      })
    );
    for (const pageData of results) all.push(...pageData);
  }

  return all;
}

// Sender Emails — paginated fetch all
export async function getAllSenderEmails(): Promise<import('@/lib/types/emailbison').SenderEmail[]> {
  type Page = {
    data: import('@/lib/types/emailbison').SenderEmail[];
    meta?: { last_page: number; current_page: number };
  };

  const page1 = await fetchApi<Page>('/api/sender-emails?page=1&per_page=100');
  const all = [...(page1.data || [])];
  const lastPage = page1.meta?.last_page || 1;

  if (lastPage > 1) {
    const pages = Array.from({ length: lastPage - 1 }, (_, i) => i + 2);
    const results = await Promise.all(
      pages.map(async (p) => {
        try {
          const res = await fetchApi<Page>(`/api/sender-emails?page=${p}&per_page=100`);
          return res.data || [];
        } catch {
          return [];
        }
      })
    );
    for (const pageData of results) all.push(...pageData);
  }

  return all;
}

// Switch workspace context
export async function switchWorkspace(teamId: number) {
  return fetchApi<{ data: unknown }>('/api/workspaces/switch-workspace', {
    method: 'POST',
    body: { team_id: teamId },
  });
}

// Sequence Steps with full content
export interface SequenceStep {
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
}

// Raw API response structure (may vary)
interface RawSequenceStep {
  id?: number;
  sequence_step_id?: string;
  order?: number;
  email_subject?: string;
  subject?: string;
  email_body?: string;
  email_body_preview?: string;
  body?: string;
  html_body?: string;
  text_body?: string;
  wait_in_days?: number;
  delay_days?: number;
  delay_hours?: number;
  is_variant?: boolean;
  variant_letter?: string;
  is_thread_reply?: boolean;
  sent?: number;
  unique_replies?: number;
  reply_rate?: number;
}

export async function getCampaignSequenceSteps(campaignId: number): Promise<{ data: SequenceStep[] }> {
  // Try multiple possible endpoints
  const endpoints = [
    `/api/campaigns/${campaignId}/sequence-steps`,
    `/api/campaigns/${campaignId}/emails`,
    `/api/campaigns/${campaignId}/steps`,
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await fetchApi<{ data: RawSequenceStep[] }>(endpoint);
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        // Normalize the data structure
        const normalized: SequenceStep[] = response.data.map((step, idx) => ({
          id: step.id || idx,
          sequence_step_id: step.sequence_step_id,
          order: step.order || idx + 1,
          subject: step.email_subject || step.subject || '',
          body: step.email_body || step.email_body_preview || step.body || step.html_body || step.text_body || '',
          delay_days: step.wait_in_days || step.delay_days,
          delay_hours: step.delay_hours,
          is_variant: step.is_variant,
          variant_letter: step.variant_letter,
          is_thread_reply: step.is_thread_reply,
          sent: step.sent,
          unique_replies: step.unique_replies,
          reply_rate: step.reply_rate,
        }));
        return { data: normalized };
      }
    } catch {
      // Try next endpoint
      continue;
    }
  }

  // If all endpoints fail, return empty array
  return { data: [] };
}
