/* /agents/:id/eval-cases/:caseId — standalone page for editing an eval case.
   Loads the case via useEvalCase; shows Skeleton while loading, ErrorState on error. */
"use client";

import React from "react";
import { useParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Skeleton, ErrorState } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { useEvalCase } from "@/lib/hooks/evals";
import { ApiError } from "@/services/api";
import { CaseEditor } from "../_components/CaseEditor";

export default function EvalCasePage() {
  const { id, caseId } = useParams<{ id: string; caseId: string }>();
  const t = useTranslations("eval");

  const { data: evalCase, isLoading, isError, error, refetch } =
    useEvalCase(caseId);

  const crumb = [
    { label: t("page.crumbAgents"), href: "/agents" },
    { label: id, href: `/agents/${id}` },
    { label: t("page.crumbEvals"), href: `/agents/${id}?tab=evals` },
    { label: evalCase?.name ?? t("page.crumbEvalCase") },
  ];

  if (isError || (!isLoading && !evalCase)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this eval case"
          body={
            error instanceof ApiError
              ? error.message
              : "The eval case could not be loaded."
          }
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {isLoading || !evalCase ? (
        <div
          style={{
            padding: "24px 32px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          <Skeleton height={24} width={240} />
          <Skeleton height={120} />
          <Skeleton height={200} />
        </div>
      ) : (
        <CaseEditor
          agentId={id}
          caseId={caseId}
          initialValues={evalCase}
        />
      )}
    </AppShell>
  );
}
