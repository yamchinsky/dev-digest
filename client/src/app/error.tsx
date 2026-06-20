"use client";

import { ErrorState } from "@devdigest/ui";

/** Route-level error boundary. Catches errors thrown by server components and
    client components within the segment. Must be a Client Component per Next.js. */
export default function GlobalError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <ErrorState
      fullScreen
      title="Something went wrong"
      body={error.message || "An unexpected error occurred."}
      onRetry={reset}
    />
  );
}
