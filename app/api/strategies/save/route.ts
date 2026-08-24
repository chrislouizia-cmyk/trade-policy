import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getBillingState } from '@/lib/billing/entitlements';
import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';
import { deriveRequiredEvidence, ZeroRequiredRulesError } from '@/lib/strategy-policy';
import { validateStrategyName } from '@/lib/strategy-name';
import type { StrategyRule } from '@/types/trade';

export const dynamic = 'force-dynamic';

const strategyRuleSchema = z
  .object({
    rule_key: z.string().trim().min(1),
    label: z.string().trim().min(1),
    enabled: z.boolean(),
    mandatory: z.boolean(),
    weight: z.union([z.number(), z.string()]).transform((value) => Number(value)).refine((value) => Number.isFinite(value) && value > 0),
    minimum_confidence: z.union([z.number(), z.string()]).transform((value) => Number(value)).refine((value) => Number.isFinite(value) && value >= 0),
    timeframe_role: z.enum(['MACRO', 'TREND', 'CONFIRMATION', 'ENTRY', 'TRIGGER']),
    evaluation_mode: z.enum(['AUTOMATIC', 'MANUAL', 'EXTERNAL']).optional().default('AUTOMATIC'),
  })
  .transform((rule) => ({
    ruleKey: rule.rule_key,
    label: rule.label,
    enabled: rule.enabled,
    mandatory: rule.mandatory,
    weight: Number(rule.weight),
    minimumConfidence: Number(rule.minimum_confidence),
    timeframeRole: rule.timeframe_role,
    evaluationMode: rule.evaluation_mode,
  }) satisfies StrategyRule);

const schema = z.object({
  strategyId: z.string().uuid().nullable(),
  activate: z.boolean(),
  profile: z
    .record(z.string(), z.unknown())
    .superRefine((value, ctx) => {
      const nameError = typeof value.name === 'string' ? validateStrategyName(value.name) : 'Strategy name is required.';
      if (nameError) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: nameError,
        });
      }

      const ai = value.ai_behavior;
      const threshold =
        ai && typeof ai === 'object'
          ? Number(
              (ai as Record<string, unknown>).confidenceThreshold,
            )
          : Number.NaN;

      if (
        !Number.isFinite(threshold) ||
        threshold < 0 ||
        threshold > 100
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'AI confidence threshold must be between 0 and 100.',
        });
      }

      for (const key of [
        'macro_timeframe',
        'trend_timeframe',
        'confirmation_timeframe',
        'entry_timeframe',
        'trigger_timeframe',
      ]) {
        if (
          typeof value[key] !== 'string' ||
          !(value[key] as string).trim()
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${key.replaceAll('_', ' ')} is required.`,
          });
        }
      }
    }),
  instruments: z
    .array(z.record(z.string(), z.unknown()))
    .min(1),
  sessions: z.array(z.record(z.string(), z.unknown())),
  rules: z.array(strategyRuleSchema),
  stopLimits: z.array(z.record(z.string(), z.unknown())),
});

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return apiError(
        'UNAUTHORIZED',
        'Unauthorized.',
        401,
      );
    }

    const parsed = schema.safeParse(await request.json());

    if (!parsed.success) {
      return apiError(
        'INVALID_STRATEGY',
        parsed.error.issues[0]?.message ||
          'Strategy data is invalid.',
        400,
        parsed.error.flatten(),
      );
    }

    const payload = parsed.data;
    const requiredEvidence = deriveRequiredEvidence(payload.rules, payload.profile.evidence_weights ?? {});
    if (!requiredEvidence.length && payload.activate) {
      return apiError(
        'STRATEGY_REQUIRED_RULE_MISSING',
        'Strategy setup required: add at least one enabled, supported, mandatory rule before saving or activating this playbook.',
        409,
      );
    }

    if (!payload.strategyId) {
      const billing = await getBillingState(user.id);

      if (!billing.entitlements) {
        return apiError(
          'BILLING_UNAVAILABLE',
          'Billing entitlements are unavailable.',
          500,
        );
      }

      const maximumActiveStrategies =
        billing.entitlements.maximumActiveStrategies;

      if (maximumActiveStrategies !== null) {
        const { count, error: countError } = await supabase
          .from('strategy_profiles')
          .select('id', {
            count: 'exact',
            head: true,
          })
          .eq('user_id', user.id)
          .eq('is_archived', false);

        if (countError) {
          return apiError(
            'STRATEGY_COUNT_FAILED',
            countError.message,
            500,
          );
        }

        if ((count ?? 0) >= maximumActiveStrategies) {
          return apiError(
            'STRATEGY_LIMIT_REACHED',
            `Your ${billing.plan} plan allows ${maximumActiveStrategies} active strategies. Archive one or upgrade to continue.`,
            403,
          );
        }
      }
    }

    const previousRules = payload.strategyId
      ? (
          await supabase
            .from('strategy_rules')
            .select(
              'rule_key,label,enabled,mandatory,weight,minimum_confidence,timeframe_role,evaluation_mode',
            )
            .eq('strategy_id', payload.strategyId)
            .eq('user_id', user.id)
        ).data ?? []
      : [];

    const derivedRequiredEvidence = deriveRequiredEvidence(payload.rules, payload.profile.evidence_weights ?? {});
    if (!derivedRequiredEvidence.length && payload.activate) {
      throw new ZeroRequiredRulesError();
    }

    const { data, error } = await supabase.rpc(
      'save_strategy_bundle',
      {
        p_strategy_id: payload.strategyId,
        p_profile: {
          ...payload.profile,
          required_evidence: derivedRequiredEvidence,
        },
        p_instruments: payload.instruments,
        p_sessions: payload.sessions,
        p_rules: payload.rules,
        p_stop_limits: payload.stopLimits,
        p_activate: payload.activate,
      },
    );

    if (error) {
      return apiError(
        'STRATEGY_SAVE_FAILED',
        error.message,
        500,
      );
    }

    if (!data?.strategyId || data.saved !== true) {
      return apiError(
        'STRATEGY_SAVE_FAILED',
        'Strategy was not returned after saving.',
        500,
      );
    }

    const modeWrites = payload.rules.map((rule) => {
      const requested = String(
        rule.evaluationMode ?? 'AUTOMATIC',
      );

      const evaluationMode = [
        'AUTOMATIC',
        'MANUAL',
        'EXTERNAL',
      ].includes(requested)
        ? requested
        : 'AUTOMATIC';

      return supabase
        .from('strategy_rules')
        .update({
          evaluation_mode: evaluationMode,
        })
        .eq('strategy_id', data.strategyId)
        .eq('user_id', user.id)
        .eq(
          'rule_key',
          String(rule.ruleKey ?? ''),
        );
    });

    const modeResults = await Promise.all(modeWrites);
    const modeError = modeResults.find(
      (result) => result.error,
    )?.error;

    if (modeError) {
      return apiError(
        'RULE_MODE_SAVE_FAILED',
        modeError.message,
        500,
      );
    }

    if (payload.strategyId) {
      const normalizeComparableRule = (rule: StrategyRule) => JSON.stringify([
        rule.label,
        rule.enabled,
        rule.mandatory,
        rule.weight,
        rule.minimumConfidence,
        rule.timeframeRole,
        rule.evaluationMode ?? 'AUTOMATIC',
      ]);

      const before = new Map(
        previousRules.map((rule: Record<string, unknown>) => [
          String(rule.rule_key),
          JSON.stringify([
            rule.label ?? null,
            Boolean(rule.enabled),
            Boolean(rule.mandatory),
            Number(rule.weight ?? 0),
            Number(rule.minimum_confidence ?? 0),
            rule.timeframe_role ?? null,
            String(rule.evaluation_mode ?? 'AUTOMATIC'),
          ]),
        ]),
      );

      const after = new Map(
        payload.rules.map((rule) => [
          String(rule.ruleKey ?? ''),
          normalizeComparableRule(rule),
        ]),
      );

      const edited = [
        ...new Set([
          ...before.keys(),
          ...after.keys(),
        ]),
      ].filter(
        (key) =>
          key &&
          before.get(key) !== after.get(key),
      );

      if (edited.length) {
        const { error: metricError } =
          await supabase.rpc(
            'record_playbook_rule_edits',
            {
              p_playbook_id: data.strategyId,
              p_rule_keys: edited,
            },
          );

        if (metricError) {
          console.error(
            'Playbook rule edit metric failed.',
            metricError.message,
          );
        }
      }
    }

    const {
      data: persisted,
      error: verifyError,
    } = await supabase
      .from('strategy_profiles')
      .select(
        'id,name,is_default,engine_version,ai_behavior,macro_timeframe,trend_timeframe,confirmation_timeframe,entry_timeframe,trigger_timeframe',
      )
      .eq('id', data.strategyId)
      .eq('user_id', user.id)
      .single();

    if (verifyError || !persisted) {
      return apiError(
        'STRATEGY_VERIFY_FAILED',
        verifyError?.message ||
          'Strategy could not be verified after saving.',
        500,
      );
    }

    return NextResponse.json(
      {
        ...data,
        strategy: persisted,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  } catch (error) {
    if (error instanceof ZeroRequiredRulesError) {
      return apiError(
        'STRATEGY_REQUIRED_RULE_MISSING',
        error.message,
        409,
      );
    }

    const detail =
      error instanceof Error
        ? error.message
        : 'Unknown persistence error.';

    return apiError(
      'STRATEGY_SAVE_FAILED',
      `Could not save strategy: ${detail}`,
      500,
    );
  }
}
