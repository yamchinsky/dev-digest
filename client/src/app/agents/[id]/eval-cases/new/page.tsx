/* /agents/:id/eval-cases/new — standalone page for creating a new eval case.
   Follows the same client-component + useParams pattern as agents/[id]/page.tsx. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { CaseEditor } from "../_components/CaseEditor";

export default function NewEvalCasePage() {
  const { id } = useParams<{ id: string }>();
  const t = useTranslations("eval");

  const crumb = [
    { label: t("page.crumbAgents"), href: "/agents" },
    { label: id, href: `/agents/${id}` },
    { label: t("page.crumbEvals"), href: `/agents/${id}?tab=evals` },
    { label: t("page.crumbNewCase") },
  ];

  return (
    <AppShell crumb={crumb}>
      <CaseEditor agentId={id} />
    </AppShell>
  );
}
