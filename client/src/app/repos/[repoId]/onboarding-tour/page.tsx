/* onboarding-tour/page.tsx — /repos/:repoId/onboarding-tour
   Thin client route; delegates all state logic to the feature component. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { useActiveRepo } from "@/providers/repo-context";
import { OnboardingTour } from "./_components/OnboardingTour";

export default function OnboardingTourPage() {
  const { repoId } = useParams<{ repoId: string }>();
  const { activeRepo } = useActiveRepo();
  const t = useTranslations("onboardingTour");
  const repoName = activeRepo?.full_name ?? repoId;

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: t("title") }]}>
      <OnboardingTour repoId={repoId} />
    </AppShell>
  );
}
