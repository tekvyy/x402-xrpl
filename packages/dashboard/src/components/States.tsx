/** Small presentational primitives for loading, empty, and error states. */

export function Spinner(): JSX.Element {
  return <span className="spinner" role="status" aria-label="Loading" />;
}

export function CardSkeleton({ rows = 3 }: { rows?: number }): JSX.Element {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-line" />
      ))}
    </div>
  );
}

export function EmptyState({ message }: { message: string }): JSX.Element {
  return <div className="empty-state">{message}</div>;
}

export function ErrorBanner({ message }: { message: string }): JSX.Element {
  return (
    <div className="error-banner" role="alert">
      {message}
    </div>
  );
}
