import 'server-only';

export {
  INTERNAL_LIFECYCLE_SMOKE_TEST_MODE,
  isTradeLifecycleV2Enabled,
  isTradeLifecycleSimulationEnabled,
  isTradeLifecycleSimulationRequest,
  isTradeLifecycleSimulationRecord,
  getTradeLifecycleSimulationLabel,
  attachTradeLifecycleSimulationMetadata,
  buildTradeLifecycleV2ActivationMode,
  type TradeLifecycleV2ActivationMode,
  type TradeLifecycleV2ActivationRequest,
} from '../trade-lifecycle-v2-core.ts';
