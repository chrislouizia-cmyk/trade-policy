import 'server-only';

import type { EvidenceKey, StrategyProfile, TradeInput, TradeResult } from '@/types/trade';
import type { DailyTradeContext } from '@/lib/server/daily-trade-context';
import { normalizeStrategyPolicy } from '@/lib/strategy-policy';
import { evaluateRequiredRules, ruleLabel } from '@/lib/manual-confirmations';

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const labels: Record<EvidenceKey, string> = {
  h4TrendAligned: 'Trend timeframe aligned',
  h1TrendAligned: 'Confirmation timeframe aligned',
  structurePattern: 'HH/HL or LH/LL structure',
  liquiditySweep: 'Liquidity sweep',
  chochConfirmed: 'ChoCH confirmed',
  bosConfirmed: 'BoS confirmed',
  orderBlock: 'Valid order block',
  fairValueGap: 'Valid fair value gap',
  retestConfirmed: 'Retest / rejection confirmed',
};

function stopValueInPrice(profile: StrategyProfile, input: TradeInput, value: number): number {
  const configured = profile.stopLimitSettings?.find(
    (limit) => limit.instrument === input.instrument,
  );

  if (!configured) {
    return profile.stopLimits[input.instrument] ?? Number.POSITIVE_INFINITY;
  }

  switch (configured.method) {
    case 'PIPS': {
      const pipSize = input.instrument.endsWith('JPY') ? 0.01 : 0.0001;
      return value * pipSize;
    }
    case 'POINTS': {
      const pointSize =
        input.instrument.startsWith('XAU') || input.instrument.startsWith('XAG')
          ? 0.01
          : 1;
      return value * pointSize;
    }
    case 'TICKS':
      return value * 0.25;
    case 'PERCENT':
      return Math.abs(input.entry) * (value / 100);
    case 'ATR':
    case 'STRUCTURAL':
      return Number.POSITIVE_INFINITY;
    default:
      return Number.POSITIVE_INFINITY;
  }
}

function protectedFloor(profile: StrategyProfile, realizedDailyPnl: number): number {
  const mode = profile.greenDayProtectedFloorMode ?? 'ZERO';
  const value = Math.max(0, Number(profile.greenDayProtectedFloorValue ?? 0));

  if (mode === 'FIXED') return value;
  if (mode === 'PERCENT_OF_PROFIT') {
    return Math.max(0, realizedDailyPnl * (value / 100));
  }
  return 0;
}

export function validateTradeWithStrategy(
  input: TradeInput,
  profile: StrategyProfile,
  dailyContext?: DailyTradeContext,
): TradeResult {
  const policy=normalizeStrategyPolicy(profile);
  const configuredStop = profile.stopLimitSettings?.find((limit) => limit.instrument === input.instrument);
  const instrumentStopLimit = stopValueInPrice(profile, input, configuredStop?.maximumValue ?? Number.POSITIVE_INFINITY);
  const instrumentStopMinimum = configuredStop?.minimumValue ? stopValueInPrice(profile, input, configuredStop.minimumValue) : 0;
  const instrumentStopPreferred = configuredStop?.preferredValue ? stopValueInPrice(profile, input, configuredStop.preferredValue) : null;
  const riskDistance = Math.abs(input.entry - input.stopLoss);
  const rewardDistance = Math.abs(input.takeProfit - input.entry);
  const rr = riskDistance > 0 ? rewardDistance / riskDistance : 0;
  const evidenceKeys = Object.keys(profile.evidenceWeights) as EvidenceKey[];
  const riskAmount = round(input.accountBalance * (input.riskPercent / 100));

  const contextItems = [
    {
      label: `RR at least 1:${policy.minimumRR}`,
      earned: rr >= policy.minimumRR ? 7 : 0,
      possible: 7,
    },
    {
      label: 'Stop inside configured operating range',
      earned: riskDistance <= instrumentStopLimit && riskDistance >= instrumentStopMinimum ? 4 : 0,
      possible: 4,
    },
    {
      label: `Risk at or below ${policy.maximumRisk}%`,
      earned: input.riskPercent <= policy.maximumRisk ? 4 : 0,
      possible: 4,
    },
    {
      label: 'Allowed session',
      earned: policy.allowedSessions.includes(input.session) ? 3 : 0,
      possible: 3,
    },
    {
      label: 'News rule respected',
      earned: !policy.avoidHighImpactNews || !input.highImpactNews ? 2 : 0,
      possible: 2,
    },
  ];

  const raw = [
    ...evidenceKeys.map((key) => ({
      label: labels[key],
      earned: input[key] ? profile.evidenceWeights[key] : 0,
      possible: profile.evidenceWeights[key],
    })),
    ...contextItems,
  ];

  const possible = raw.reduce((sum, item) => sum + item.possible, 0) || 1;
  const scoreItems = raw.map((item) => ({
    ...item,
    earned: round((item.earned / possible) * 100),
    possible: round((item.possible / possible) * 100),
  }));
  const score = round(
    (raw.reduce((sum, item) => sum + item.earned, 0) / possible) * 100,
  );
  const vetoes: string[] = [];
  const observations: string[] = [];
  let overrideAllowed = true;

  if (!policy.instruments.includes(input.instrument)) {
    vetoes.push('Instrument is not enabled in this strategy.');
  }
  if (
    policy.requireTrendAlignment &&
    (!input.h4TrendAligned || !input.h1TrendAligned)
  ) {
    vetoes.push('Required timeframe alignment is missing.');
  }
  const rules=profile.rules??[];
  const ruleByKey=new Map(rules.map(rule=>[rule.ruleKey,rule]));
  let mandatoryPending=false;
  policy.requiredConfirmations.forEach((key) => {
    if(!ruleByKey.has(key)&&!input[key])vetoes.push(`${ruleLabel(key,labels[key])} is mandatory.`);
  });
  const requiredRules=evaluateRequiredRules(rules,input.manualConfirmations??[],input as unknown as Record<string,unknown>);
  for(const rule of requiredRules.filter(rule=>rule.state==='FAILED'))vetoes.push(rule.mode==='MANUAL'?`${rule.label} failed manual confirmation.`:`${rule.label} is mandatory.`);
  mandatoryPending=requiredRules.some(rule=>rule.state==='NOT_EVALUATED');
  if (rr < policy.minimumRR) {
    vetoes.push(`RR is ${round(rr)}; strategy minimum is ${policy.minimumRR}.`);
  }
  if (input.riskPercent > policy.maximumRisk) {
    vetoes.push(`Risk exceeds ${policy.maximumRisk}%.`);
  }
  if (!policy.allowedSessions.includes(input.session)) {
    vetoes.push('Session is not allowed by this strategy.');
  }
  if (riskDistance > instrumentStopLimit) {
    vetoes.push('Stop distance exceeds this strategy maximum.');
  }
  if (instrumentStopMinimum > 0 && riskDistance < instrumentStopMinimum) {
    vetoes.push('Stop distance is narrower than the minimum configured for this instrument and trading style.');
  }
  if (instrumentStopPreferred && riskDistance !== instrumentStopPreferred) {
    observations.push(`Preferred stop distance for this instrument is approximately ${round(instrumentStopPreferred, 5)} in price terms.`);
  }
  if (policy.avoidHighImpactNews && input.highImpactNews) {
    vetoes.push('High-impact news conflict detected.');
  }
  if (
    (!input.setupType || input.setupType==='Unclear' || policy.forbiddenSetups.includes(input.setupType) || Boolean(policy.allowedSetups&&!policy.allowedSetups.includes(input.setupType)))
  ) {
    vetoes.push(input.setupType?'Setup type is not enabled in this strategy.':'Setup classification is required before authorization.');
  }
  if (!input.orderBlock && !input.fairValueGap) {
    observations.push('No valid OB or FVG identified.');
  }
  if (!input.retestConfirmed) {
    observations.push('Retest or rejection is still pending.');
  }

  const grade =
    score >= 90
      ? 'A+'
      : score >= profile.authorizationScore
        ? 'A'
        : score >= profile.waitScore
          ? 'B'
          : 'C';

  const confidenceMissing=input.setupConfidence==null;
  const confidenceBelow=!confidenceMissing&&input.setupConfidence!<policy.confidenceThreshold;
  if(confidenceMissing)vetoes.push('Live strategy confidence is required before authorization.');
  if(confidenceBelow)observations.push(`Confidence ${input.setupConfidence}% is below the required ${policy.confidenceThreshold}% threshold.`);
  const baseVerdict =
    vetoes.length > 0
      ? 'REJECTED'
      : mandatoryPending
        ? 'WAIT'
      : confidenceBelow
        ? 'WAIT'
      : score >= profile.authorizationScore
        ? 'AUTHORIZED'
        : score >= profile.waitScore
          ? 'WAIT'
          : 'REJECTED';

  let greenDayExceptionApplied = false;
  let dailyMessage = '';
  const strategyLimit = Math.max(1, Number(policy.tradeLimits.strategy));
  const instrumentLimit = Math.max(
    1,
    Number(policy.tradeLimits.byInstrument[input.instrument] ?? strategyLimit),
  );
  const strategyTradesToday = dailyContext?.strategyTradesToday ?? input.tradesToday;
  const instrumentTradesToday = dailyContext?.instrumentTradesToday ?? 0;
  const extraTradesUsed = dailyContext?.extraTradesUsed ?? Math.max(0, strategyTradesToday - strategyLimit);
  const extraTradesAllowed = Math.max(0, Number(profile.greenDayMaxExtraTrades ?? 1));
  const realizedDailyPnl = Number(dailyContext?.realizedDailyPnl ?? 0);
  const openRisk = Number(dailyContext?.openRisk ?? 0);
  const floor = protectedFloor(profile, realizedDailyPnl);
  const worstCaseDailyPnl = round(realizedDailyPnl - openRisk - riskAmount);
  const limitReached =
    strategyTradesToday >= strategyLimit || instrumentTradesToday >= instrumentLimit;

  if (limitReached) {
    overrideAllowed = false;

    const greenExceptionPossible =
      Boolean(profile.greenDayProtectionEnabled) &&
      realizedDailyPnl > 0 &&
      extraTradesUsed < extraTradesAllowed &&
      worstCaseDailyPnl >= floor &&
      (!profile.greenDayRequireAuthorized || baseVerdict === 'AUTHORIZED');

    if (greenExceptionPossible && baseVerdict === 'AUTHORIZED') {
      greenDayExceptionApplied = true;
      dailyMessage = `Green Day Protection: extra trade allowed. Worst-case daily P&L remains ${worstCaseDailyPnl >= 0 ? '+' : ''}$${worstCaseDailyPnl.toFixed(2)}.`;
      observations.push(dailyMessage);

      const maxExtraRiskPercent =
        profile.maximumRiskPercent * Number(profile.greenDayExtraRiskMultiplier ?? 0.5);
      if (input.riskPercent > maxExtraRiskPercent) {
        vetoes.push(
          `Reduce risk to ${round(maxExtraRiskPercent, 2)}% or less for the Green Day extra trade.`,
        );
        greenDayExceptionApplied = false;
      }
    } else {
      if (strategyTradesToday >= strategyLimit) {
        vetoes.push(`Maximum daily strategy trades reached (${strategyTradesToday}/${strategyLimit}).`);
      }
      if (instrumentTradesToday >= instrumentLimit) {
        vetoes.push(
          `Maximum daily trades for ${input.instrument} reached (${instrumentTradesToday}/${instrumentLimit}).`,
        );
      }
      if (profile.greenDayProtectionEnabled) {
        if (realizedDailyPnl <= 0) {
          vetoes.push('Green Day exception is unavailable because realized daily P&L is not positive.');
        } else if (extraTradesUsed >= extraTradesAllowed) {
          vetoes.push('Green Day extra-trade allowance has already been used.');
        } else if (worstCaseDailyPnl < floor) {
          vetoes.push(
            `This trade could reduce the day below the protected floor. Worst case: ${worstCaseDailyPnl >= 0 ? '+' : ''}$${worstCaseDailyPnl.toFixed(2)}; required floor: +$${floor.toFixed(2)}.`,
          );
        } else if (profile.greenDayRequireAuthorized && baseVerdict !== 'AUTHORIZED') {
          vetoes.push('An extra trade after the daily limit must be fully AUTHORIZED.');
        }
      }
      dailyMessage = 'Daily trading limit is a hard risk control and cannot be overridden with Take Anyway.';
    }
  }

  const verdict = vetoes.length > 0 ? 'REJECTED' : baseVerdict;

  return {
    score,
    grade,
    verdict,
    rr: round(rr),
    riskAmount,
    stopDistance: round(riskDistance, 5),
    vetoes: [...new Set(vetoes)],
    observations,
    scoreItems,
    direction: input.direction,
    overrideAllowed,
    dailyLimits: {
      strategyTradesToday,
      strategyLimit,
      instrumentTradesToday,
      instrumentLimit,
      extraTradesUsed,
      extraTradesAllowed,
      realizedDailyPnl: round(realizedDailyPnl),
      openRisk: round(openRisk),
      protectedFloor: round(floor),
      worstCaseDailyPnl,
      greenDayExceptionApplied,
      message: dailyMessage || undefined,
    },
  };
}
