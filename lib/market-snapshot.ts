import type {ChartAnalysis} from '@/types/trade';

export type MarketSnapshotContext={
  strategyId:string;
  strategyRevisionId:string;
  instrument:string;
};

export type MarketSnapshotRow={
  id:string;
  created_at:string;
  strategy_profile_id:string|null;
  strategy_revision_id:string|null;
  instrument:string;
  analysis:unknown;
};

export type RestoredMarketSnapshot={analysis:ChartAnalysis;snapshotCreatedAt:string};

const analysisStatuses=new Set<ChartAnalysis['status']>(['DATA_UNAVAILABLE','INSUFFICIENT_DATA','STRATEGY_UNSUPPORTED','STRATEGY_INCOMPLETE','ANALYSIS_FAILED','NO_RELEVANT_EVIDENCE','VALID_ANALYSIS']);
const resultStatuses=new Set<ChartAnalysis['analysisStatus']>(['DATA_UNAVAILABLE','INSUFFICIENT_DATA','STRATEGY_UNSUPPORTED','STRATEGY_INCOMPLETE','ANALYSIS_FAILED','NO_RELEVANT_EVIDENCE','VALID_ANALYSIS']);

export function restoreMarketSnapshot(row:MarketSnapshotRow,context:MarketSnapshotContext):RestoredMarketSnapshot|null{
  if(row.strategy_profile_id!==context.strategyId||row.strategy_revision_id!==context.strategyRevisionId||row.instrument!==context.instrument)return null;
  if(!row.analysis||typeof row.analysis!=='object')return null;
  const analysis=row.analysis as Partial<ChartAnalysis>;
  if(analysis.strategyId!==context.strategyId||analysis.instrument!==context.instrument||!analysisStatuses.has(analysis.status as ChartAnalysis['status'])||!resultStatuses.has(analysis.analysisStatus as ChartAnalysis['analysisStatus'])||typeof analysis.calculatedAt!=='string')return null;
  return {analysis:{...analysis,analysisId:row.id} as ChartAnalysis,snapshotCreatedAt:row.created_at};
}
