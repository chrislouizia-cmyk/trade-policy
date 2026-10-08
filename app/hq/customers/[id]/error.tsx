"use client";

export default function CustomerProfileError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="card directory-error-state">
      <strong>Customer profile could not be loaded.</strong>
      <p>
        Retry once. If the problem continues, the failed Customer 360 operation
        has been recorded for investigation.
      </p>
      <button type="button" onClick={reset}>
        Retry
      </button>
    </section>
  );
}
