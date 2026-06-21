/* Root — server component that redirects to the first repo's PR list, or
   renders an onboarding prompt when no repos exist. Avoids the useEffect
   anti-pattern by doing the read + redirect server-side. */
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { getRepos } from "@/services/repos";
import { OnboardingPrompt } from "./_components/OnboardingPrompt/OnboardingPrompt";

export default async function HomePage() {
  const repos = await getRepos();
  if (repos.length > 0) {
    redirect(`/repos/${repos[0]!.id}/pulls`);
  }
  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <PageContainer title="Welcome to DevDigest" subtitle="Local-first AI PR review">
        <OnboardingPrompt />
      </PageContainer>
    </AppShell>
  );
}
