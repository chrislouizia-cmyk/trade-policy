import { NextResponse } from 'next/server';
import { publicApiError, cleanProviderMessage } from '@/lib/server/public-error';
import type { PostTradeAnalysis } from '@/types/trade';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const { image, outcome, instrument, direction, setupType, entry, stopLoss, takeProfit, resultR } = await req.json();
    if (!image || !outcome) return NextResponse.json({ error: 'Post-trade screenshot and outcome are required.' }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Post-trade review is temporarily unavailable.', code:'POST_TRADE_REVIEW_UNAVAILABLE' }, { status: 503 });

    const schema = {
      type: 'object', additionalProperties: false,
      required: ['outcome','setupStillValid','executionQuality','whatHappened','likelyFactors','ruleViolations','lesson','patternTag','confidence'],
      properties: {
        outcome: { enum: ['WIN','LOSS','BREAKEVEN','PARTIAL'] },
        setupStillValid: { type: 'boolean' },
        executionQuality: { enum: ['GOOD','MIXED','POOR','UNCLEAR'] },
        whatHappened: { type: 'string' },
        likelyFactors: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        ruleViolations: { type: 'array', items: { type: 'string' }, maxItems: 6 },
        lesson: { type: 'string' },
        patternTag: { type: 'string' },
        confidence: { type: 'number', minimum: 0, maximum: 100 }
      }
    };

    const prompt = `You are Trade Police reviewing a CLOSED trade. Analyze the post-trade chart objectively. Distinguish outcome from decision quality: a winning trade may be poorly executed and a losing trade may be valid. User rules: H4/H1 trend and structure, M30 refinement when available, price action, HH/HL or LH/LL, liquidity sweep, ChoCH, BoS, FVG, order block, retest, minimum 1:3 RR, max 0.5% risk. Determine what likely happened, whether the setup remained valid, any rule violations, a concise lesson, and a reusable pattern tag. Do not invent invisible facts. Trade metadata: instrument=${instrument}, direction=${direction}, setup=${setupType}, entry=${entry}, SL=${stopLoss}, TP=${takeProfit}, result=${resultR}R, declared outcome=${outcome}.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: image, detail: 'high' }
        ] }],
        text: { format: { type: 'json_schema', name: 'trade_police_post_trade', strict: true, schema } }
      })
    });

    const raw = await response.json();
    if (!response.ok) return NextResponse.json({ error: raw?.error?.message || 'Post-trade analysis failed.' }, { status: 502 });
    const text = raw.output_text ?? raw.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text;
    if (!text) return NextResponse.json({ error: 'No structured post-trade analysis returned.' }, { status: 502 });
    return NextResponse.json(JSON.parse(text) as PostTradeAnalysis);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unexpected post-trade error.' }, { status: 500 });
  }
}
