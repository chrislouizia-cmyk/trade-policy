export function summarizeStrategyBuilderBootstrapFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === 'string' && error.trim()) return error.trim();
  return 'Strategy Builder could not load your saved strategies. Retry to refresh the data.';
}

export function resolveStrategyBuilderBootstrapRenderState({ loading, bootstrapError }: { loading: boolean; bootstrapError: string | null }) {
  if (bootstrapError) return 'error';
  if (loading) return 'loading';
  return 'ready';
}

export async function runStrategyBuilderBootstrap<T>(
  task: () => Promise<T>,
  onSuccess: (result: T) => Promise<void> | void,
  onError: (error: unknown) => void,
  setLoading: (value: boolean) => void,
): Promise<T | undefined> {
  try {
    const result = await task();
    await onSuccess(result);
    return result;
  } catch (error) {
    onError(error);
    return undefined;
  } finally {
    setLoading(false);
  }
}
