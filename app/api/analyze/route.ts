import { NextResponse } from 'next/server';
import { publicApiError, cleanProviderMessage } from '@/lib/server/public-error';
import { DEFAULT_STRATEGY_PROFILE } from '@/types/trade';
import type { ChartAnalysis, EvidenceKey, Instrument, StrategyProfile } from '@/types/trade';

export const runtime = 'nodejs';
export const maxDuration = 60;

const evidenceKeys: EvidenceKey[] = ['h4TrendAligned','h1TrendAligned','structurePattern','liquiditySweep','chochConfirmed','bosConfirmed','orderBlock','fairValueGap','retestConfirmed'];

export async function POST(req: Request) {
  try {
    const { instrument, h4Image, h1Image, m30Image, strategyProfile } = await req.json();
    const strategy: StrategyProfile = strategyProfile || DEFAULT_STRATEGY_PROFILE;
    if (!instrument || !h4Image || !h1Image || !m30Image) return NextResponse.json({ error: 'H4, H1, and M30 images are required.' }, { status: 400 });
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: 'Chart analysis is temporarily unavailable.', code:'CHART_ANALYSIS_UNAVAILABLE', demo: demoAnalysis(instrument) }, { status: 503 });

    const schema = {
      type: 'object', additionalProperties: false,
      required: ['instrument','detectedTimeframes','h4Bias','h1Bias','suggestedDirection','setupType','setupConfidence','evidence','candidates','warnings','summary'],
      properties: {
        instrument: { enum: ['XAUUSD','GBPUSD','GBPJPY'] },
        detectedTimeframes: { type: 'array', items: { type: 'string' } },
        h4Bias: { enum: ['BULLISH','BEARISH','RANGE','UNCLEAR'] },
        h1Bias: { enum: ['BULLISH','BEARISH','RANGE','UNCLEAR'] },
        suggestedDirection: { anyOf: [{ enum: ['BUY','SELL'] }, { type: 'null' }] },
        setupType: { enum: ['Liquidity Sweep + ChoCH + BoS','FVG Retest','Order Block Retest','Breakout Retest','Continuation','Reversal','Unclear'] },
        setupConfidence: { type: 'number', minimum: 0, maximum: 100 },
        evidence: {
          type: 'object', additionalProperties: false, required: evidenceKeys,
          properties: Object.fromEntries(evidenceKeys.map(k => [k, { type: 'object', additionalProperties: false, required: ['value','confidence','reason'], properties: { value: { type: 'boolean' }, confidence: { type: 'number', minimum: 0, maximum: 100 }, reason: { type: 'string' } } }]))
        },
        candidates: { type: 'array', maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['id','direction','entryLow','entryHigh','stopLoss','takeProfit','rr','status','rationale'], properties: {
          id: { type: 'string' }, direction: { enum: ['BUY','SELL'] }, entryLow: { anyOf: [{type:'number'},{type:'null'}] }, entryHigh: { anyOf: [{type:'number'},{type:'null'}] }, stopLoss: { anyOf: [{type:'number'},{type:'null'}] }, takeProfit: { anyOf: [{type:'number'},{type:'null'}] }, rr: { anyOf: [{type:'number'},{type:'null'}] }, status: { enum: ['READY','WAIT','INVALID'] }, rationale: { type: 'string' }
        } } },
        warnings: { type: 'array', items: { type: 'string' } }, summary: { type: 'string' }
      }
    };

    const required = strategy.requiredEvidence.join(', ');
    const prompt = `You are Trade Police, a conservative chart-review assistant. Analyze the supplied ${strategy.trendTimeframe}, ${strategy.confirmationTimeframe}, and ${strategy.entryTimeframe} screenshots for ${instrument}. Apply this user's strategy profile exactly: minimum RR 1:${strategy.minimumRR}; maximum risk ${strategy.maximumRiskPercent}%; trend alignment required=${strategy.requireTrendAlignment}; mandatory evidence=${required}; allowed sessions=${strategy.allowedSessions.join(', ')}. Evaluate price action, HH/HL or LH/LL, liquidity sweep, ChoCH, BoS, FVG, order block, and retest according to the profile. Do not claim certainty. Only mark evidence true when visually supported; reduce confidence when labels, timeframe, symbol, price scale, or candle history are unclear. Suggest at most 3 probable rule-based candidates, never perfect entries. Candidate levels may be null when the screenshot cannot support exact prices. Every candidate with RR below 1:${strategy.minimumRR} MUST be INVALID. Maximum stop distance for ${instrument}: ${strategy.stopLimits[instrument as Instrument]}. Explain invalidation and use WAIT when confirmation is missing. Use ${strategy.entryTimeframe} for refined entry confirmation. The deterministic app, not you, issues final authorization.`;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
        input: [{ role: 'user', content: [
          { type: 'input_text', text: prompt },
          { type: 'input_text', text: 'H4 chart:' }, { type: 'input_image', image_url: h4Image, detail: 'high' },
          { type: 'input_text', text: 'H1 chart:' }, { type: 'input_image', image_url: h1Image, detail: 'high' },
          { type: 'input_text', text: 'M30 chart for refined entry:' }, { type: 'input_image', image_url: m30Image, detail: 'high' }
        ] }],
        text: { format: { type: 'json_schema', name: 'trade_police_chart_analysis', strict: true, schema } }
      })
    });

    const raw = await response.json();
    if (!response.ok) return NextResponse.json({ error: cleanProviderMessage(response.status), code:'CHART_ANALYSIS_UNAVAILABLE' }, { status: response.status===429?429:502 });
    const text = raw.output_text ?? raw.output?.flatMap((o: any) => o.content ?? []).find((c: any) => c.type === 'output_text')?.text;
    if (!text) return NextResponse.json({ error: 'No structured analysis returned.' }, { status: 502 });
    const parsed=JSON.parse(text) as ChartAnalysis;
    parsed.candidates=parsed.candidates.map(c=>{
      const entry=c.entryLow??c.entryHigh;
      const calculatedRR=entry!==null&&c.stopLoss!==null&&c.takeProfit!==null&&Math.abs(entry-c.stopLoss)>0?Number((Math.abs(c.takeProfit-entry)/Math.abs(entry-c.stopLoss)).toFixed(2)):c.rr;
      const stopDistance=entry!==null&&c.stopLoss!==null?Math.abs(entry-c.stopLoss):null;
      const belowRR=calculatedRR!==null&&calculatedRR<strategy.minimumRR;
      const stopTooWide=stopDistance!==null&&stopDistance>strategy.stopLimits[instrument as Instrument];
      return {...c,rr:calculatedRR,status:(belowRR||stopTooWide)?'INVALID':c.status,rationale:`${c.rationale}${belowRR?` Minimum RR 1:${strategy.minimumRR} not met.`:''}${stopTooWide?' Stop exceeds strategy limit.':''}`};
    });
    if(strategy.requireTrendAlignment&&parsed.h4Bias!== 'UNCLEAR'&&parsed.h1Bias!=='UNCLEAR'&&parsed.h4Bias!==parsed.h1Bias){parsed.warnings.unshift('TIMEFRAME CONFLICT: trend and confirmation timeframes are not aligned.');}
    return NextResponse.json(parsed);
  } catch (error) {
    return publicApiError({message:'Chart analysis could not be completed. Your trade data was not changed.',code:'CHART_ANALYSIS_UNAVAILABLE',internalCode:'CHART_ANALYSIS_FAILED',provider:'openai',endpoint:'/api/analyze',error});
  }
}

function demoAnalysis(instrument: Instrument): ChartAnalysis {
  const e = (value=false): any => ({ value, confidence: 0, reason: 'Demo only: configure OPENAI_API_KEY for image analysis.' });
  return { instrument, detectedTimeframes: [], h4Bias:'UNCLEAR', h1Bias:'UNCLEAR', suggestedDirection:null, setupType:'Unclear', setupConfidence:0,
    evidence:{ h4TrendAligned:e(), h1TrendAligned:e(), structurePattern:e(), liquiditySweep:e(), chochConfirmed:e(), bosConfirmed:e(), orderBlock:e(), fairValueGap:e(), retestConfirmed:e() },
    candidates:[], warnings:['Image analysis is not configured.'], summary:'Configure the OpenAI API key to enable automatic chart reading.' };
}
