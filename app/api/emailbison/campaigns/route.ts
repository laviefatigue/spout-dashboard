import { NextRequest, NextResponse } from 'next/server';
import { getAllCampaigns } from '@/lib/api/emailbison';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;

    const data = await getAllCampaigns({ search, status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Campaigns fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch campaigns' },
      { status: 500 }
    );
  }
}
