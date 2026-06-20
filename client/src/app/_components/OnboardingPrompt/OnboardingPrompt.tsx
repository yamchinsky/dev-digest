"use client";

import { useRouter } from "next/navigation";
import { EmptyState } from "@devdigest/ui";

/** Empty-state card on the root page when no repos exist. Client-side because
    it routes via Next's router on click; the parent server component decides
    when to render it (i.e. only when getRepos() returns []). */
export function OnboardingPrompt() {
  const router = useRouter();
  return (
    <EmptyState
      icon="GitBranch"
      title="No repositories yet"
      body="Add a repository to start reviewing pull requests. Set your API keys once in Settings → API Keys."
      cta="Add repository"
      onCta={() => router.push("/onboarding")}
    />
  );
}
