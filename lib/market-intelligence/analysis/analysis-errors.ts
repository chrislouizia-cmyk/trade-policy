export type AnalysisStage = 'MARKET_DATA' | 'DETECTORS' | 'CONTEXT';

export class AnalysisOrchestrationError extends Error {
  readonly code: string;
  readonly stage: AnalysisStage;
  override readonly cause: unknown;

  constructor(stage: AnalysisStage, code: string, message: string, cause?: unknown) {
    super(message);
    this.name = 'AnalysisOrchestrationError';
    this.stage = stage;
    this.code = code;
    this.cause = cause;
  }
}

export function analysisError(stage: AnalysisStage, error: unknown): AnalysisOrchestrationError {
  if (error instanceof AnalysisOrchestrationError) return error;
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : `${stage}_FAILED`;
  const message = error instanceof Error ? error.message : `Automatic market intelligence ${stage.toLowerCase()} stage failed.`;
  return new AnalysisOrchestrationError(stage, code, message, error);
}
