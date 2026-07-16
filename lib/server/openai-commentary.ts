import 'server-only';

import type { AICommentary, ChartAnalysis } from '@/types/trade';

const commentarySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'message', 'nextAction'],
  properties: {
    headline: { type: 'string' },
    message: { type: 'string' },
    nextAction: { type: 'string' },
  },
};

export async function explainDeterministicAnalysis(
  analysis: ChartAnalysis,
  fallback: AICommentary,
): Promise<AICommentary> {
  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
        input: [{
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Explain this deterministic trading-engine result in concise plain language. Do not add, change, infer, or contradict any direction, confidence, evidence, candidate, confirmation, warning, or verdict. Structured result: ${JSON.stringify(analysis)}`,
          }],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'trade_police_explanation',
            strict: true,
            schema: commentarySchema,
          },
        },
      }),
    });
    if (!response.ok) return fallback;

    const raw = await response.json();
    const text = raw.output_text ?? raw.output
      ?.flatMap((item: any) => item.content ?? [])
      .find((item: any) => item.type === 'output_text')?.text;
    if (!text) return fallback;

    const explanation = JSON.parse(text) as Pick<AICommentary, 'headline' | 'message' | 'nextAction'>;
    return { ...fallback, ...explanation };
  } catch {
    return fallback;
  }
}
