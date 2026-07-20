import { z } from 'zod';
import type { DecisionNarrative } from '../../types/intelligence';

const aiResponseSchema = z.object({
  educationalExplanation: z.string().min(1).max(800),
  coachingMessage: z.string().min(1).max(400),
  learningTip: z.string().min(1).max(300),
}).strict();

const jsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'educationalExplanation',
    'coachingMessage',
    'learningTip',
  ],
  properties: {
    educationalExplanation: { type: 'string' },
    coachingMessage: { type: 'string' },
    learningTip: { type: 'string' },
  },
};

function deterministicFallback(narrative: DecisionNarrative): DecisionNarrative {
  return { ...narrative, source: 'DETERMINISTIC', fallbackUsed: true };
}

function extractResponseText(raw: any): string | undefined {
  if (typeof raw?.output_text === 'string') return raw.output_text;
  return raw?.output
    ?.flatMap((item: any) => item.content ?? [])
    .find((item: any) => item.type === 'output_text')?.text;
}

const operationalLanguage = /\b(enter|entry|buy|sell|long|short|exit|close|open|place|execute|cancel|hold|protect|move|adjust|order|position|stop[- ]?loss|take[- ]?profit)\b/i;
const verdictLanguage = /\b(authorized|authorize|ready|wait|block|blocked|reject|rejected|approve|approved|permission)\b/i;
const evidenceInterpretation = /\b(evidence|confirmed|confirmation|detected|missing|passed|failed|threshold|readiness|score|bullish|bearish|setup|veto)\b/i;
const directiveLanguage = /\b(you\s+(?:should|must|need to|can|may)|do not|don't|go ahead|now)\b/i;
const tradingClaim = /(?:\b\d+(?:\.\d+)?\s*%|\b(?:rr|risk[- ]?reward)\b|probability|profit|guarantee)/i;
const markup = /[<>]/;
const coachingVocabulary = new Set([
  'a', 'about', 'across', 'after', 'an', 'and', 'are', 'as', 'be', 'before', 'brief',
  'by', 'can', 'checklist', 'clarity', 'consistent', 'consistency', 'decision', 'decisions',
  'discipline', 'documented', 'easier', 'emotions', 'focus', 'grows', 'habit', 'habits',
  'helps', 'in', 'is', 'journal', 'learning', 'make', 'memory', 'observations', 'of', 'on',
  'or', 'patience', 'practice', 'process', 'recognize', 'recorded', 'recurring', 'reduce', 'reflection',
  'repeatable', 'repeated', 'reshape', 'review', 'routine', 'situations', 'supports', 'the',
  'through', 'to', 'when', 'with',
]);

function usesOnlyCoachingVocabulary(value: string): boolean {
  const words = value.toLowerCase().match(/[a-z]+/g) ?? [];
  return words.length > 0 && words.every((word) => coachingVocabulary.has(word));
}

function isSemanticallySafe(
  narrative: DecisionNarrative,
  candidate: z.infer<typeof aiResponseSchema>,
): boolean {
  const generated = [
    candidate.educationalExplanation,
    candidate.coachingMessage,
    candidate.learningTip,
  ];
  const protectedPhrases = [
    narrative.headline,
    narrative.explanation,
    narrative.disciplineMessage,
    ...narrative.reasons.map((reason) => reason.message),
    ...narrative.missingEvidence.flatMap((item) => [item.label, item.reason]),
    ...narrative.nextActions.flatMap((action) => [action.label, action.rationale]),
  ].map((value) => value.trim().toLowerCase()).filter((value) => value.length >= 8);

  return generated.every((value) => {
    const normalized = value.trim().toLowerCase();
    return !operationalLanguage.test(value)
      && !verdictLanguage.test(value)
      && !evidenceInterpretation.test(value)
      && !directiveLanguage.test(value)
      && !tradingClaim.test(value)
      && !markup.test(value)
      && usesOnlyCoachingVocabulary(value)
      && !protectedPhrases.some((phrase) => normalized.includes(phrase));
  });
}

export async function enhanceDecisionNarrative(
  narrative: DecisionNarrative,
  options: { timeoutMs?: number } = {},
): Promise<DecisionNarrative> {
  if (!process.env.OPENAI_API_KEY) return deterministicFallback(narrative);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 2000);

  try {
    const immutableContext = {
      recommendation: narrative.recommendation,
      engineVerdict: narrative.engineVerdict,
      readiness: narrative.readiness,
      reasons: narrative.reasons.map(({ id, status, blocking, message }) => ({
        id,
        status,
        blocking,
        message,
      })),
      missingEvidence: narrative.missingEvidence,
      actions: narrative.nextActions.map(({ id, type, blocking, label, rationale }) => ({
        id,
        type,
        blocking,
        label,
        rationale,
      })),
      headline: narrative.headline,
      explanation: narrative.explanation,
      disciplineMessage: narrative.disciplineMessage,
    };
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
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
            text: `Act only as an educational process coach. The supplied decision fields are immutable read-only context. Do not restate or reinterpret the verdict, evidence, readiness, reasons, actions, thresholds, direction, or risk. Do not recommend entering, exiting, holding, changing, or placing a trade. Return only general educational reflection about process consistency in the three schema fields. Immutable context: ${JSON.stringify(immutableContext)}`,
          }],
        }],
        text: {
          format: {
            type: 'json_schema',
            name: 'decision_narrative_wording',
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
    });
    if (!response.ok) return deterministicFallback(narrative);

    const raw = await response.json();
    const text = extractResponseText(raw);
    if (!text) return deterministicFallback(narrative);

    const parsedJson = JSON.parse(text);
    const parsed = aiResponseSchema.safeParse(parsedJson);
    if (!parsed.success || !isSemanticallySafe(narrative, parsed.data)) {
      return deterministicFallback(narrative);
    }

    return {
      ...narrative,
      source: 'AI_ENHANCED',
      fallbackUsed: false,
      educationalExplanation: parsed.data.educationalExplanation,
      coachingMessage: parsed.data.coachingMessage,
      learningTip: parsed.data.learningTip,
    };
  } catch {
    return deterministicFallback(narrative);
  } finally {
    clearTimeout(timeout);
  }
}
