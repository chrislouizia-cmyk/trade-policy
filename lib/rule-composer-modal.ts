import type { TradingDnaCategoryId } from './trading-dna/types';
import type { ComposerCondition } from './trading-dna/composer';

export type RuleComposerModalDraft = {
  targetGroupId: string;
  step: number;
  category?: TradingDnaCategoryId;
  condition?: ComposerCondition;
  editing?: boolean;
  triggerId?: string;
  openerId?: string;
};

export type RuleComposerModalAction =
  | { type: 'OPEN'; targetGroupId?: string; triggerId?: string; openerId?: string; editing?: boolean }
  | { type: 'CLOSE' }
  | { type: 'SET_CATEGORY'; category?: TradingDnaCategoryId }
  | { type: 'SET_STEP'; step?: number }
  | { type: 'SET_CONDITION'; condition?: ComposerCondition }
  | { type: 'RESET' }
  | { type: 'RERENDER' };

export function createRuleComposerModalState(
  targetGroupId: string,
  step = 1,
  overrides: Partial<RuleComposerModalDraft> = {},
): RuleComposerModalDraft {
  return { targetGroupId, step, ...overrides };
}

export function ruleComposerModalReducer(
  state: RuleComposerModalDraft | null,
  action: RuleComposerModalAction,
): RuleComposerModalDraft | null {
  switch (action.type) {
    case 'OPEN':
      if (state) return state;
      return createRuleComposerModalState(action.targetGroupId ?? 'root', 1, {
        editing: action.editing,
        triggerId: action.triggerId,
        openerId: action.openerId ?? action.triggerId,
      });
    case 'CLOSE':
      return null;
    case 'SET_CATEGORY':
      if (!state) return null;
      return { ...state, category: action.category, step: 3 };
    case 'SET_STEP':
      if (!state) return null;
      return { ...state, step: action.step ?? state.step };
    case 'SET_CONDITION':
      if (!state) return null;
      return { ...state, condition: action.condition, step: 4, editing: state.editing };
    case 'RESET':
      if (!state) return null;
      return { ...state, step: 1, condition: undefined, category: undefined, editing: false };
    case 'RERENDER':
      return state ?? null;
    default:
      return state;
  }
}

export function shouldCloseRuleComposerModal(
  event: { target: EventTarget | null; currentTarget: EventTarget | null },
): boolean {
  return event.target === event.currentTarget;
}

export function dispatchRuleComposerModalClose(
  event: { target: EventTarget | null; currentTarget: EventTarget | null; preventDefault?: () => void; stopPropagation?: () => void },
  dispatch: (action: RuleComposerModalAction) => void,
): boolean {
  if (!shouldCloseRuleComposerModal(event)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  dispatch({ type: 'CLOSE' });
  return true;
}

export function handleRuleComposerModalCloseClick(
  event: { preventDefault?: () => void; stopPropagation?: () => void },
  onClose: () => void,
): boolean {
  event.preventDefault?.();
  event.stopPropagation?.();
  onClose();
  return true;
}

export function handleRuleComposerEscapeKey(
  event: { key?: string; preventDefault?: () => void; stopPropagation?: () => void },
  isOpen: boolean,
  onClose: () => void,
): boolean {
  if (!isOpen || event.key !== 'Escape') return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  onClose();
  return true;
}

export function resolveRuleComposerOpener(
  openerId?: string | null,
  fallback?: { id?: string } | null,
): string | undefined {
  return openerId ?? fallback?.id ?? undefined;
}

export function scheduleFocusRestore(
  target: { focus?: () => void } | null | undefined,
): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => target?.focus?.());
}
