"use client";

import React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Skeleton, EmptyState, ErrorState, Button } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import {
  useConventions,
  useExtractConventions,
  type ConventionStatus,
} from "@/lib/hooks/conventions";
import { useActiveRepo, useRepoNotFound } from "@/providers/repo-context";
import { ApiError } from "@/services/api";
import { useToast } from "@/providers/toast";
import { ConventionCandidateCard } from "./_components/ConventionCandidateCard/ConventionCandidateCard";
import { BuildSkillDialog } from "./_components/BuildSkillDialog/BuildSkillDialog";
import { s } from "./styles";

type Tab = "all" | ConventionStatus;
const TABS: Array<{ key: Tab; label: string }> = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

const SKELETON_ROWS = 4;

export default function ConventionsPage() {
  const params = useParams<{ repoId: string }>();
  const repoId = params.repoId;
  const search = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const { activeRepo } = useActiveRepo();
  const repoNotFound = useRepoNotFound(repoId);

  const tab = (search.get("status") as Tab | null) ?? "pending";
  const filter = tab === "all" ? {} : { status: tab };
  const { data, isLoading, isError, error, refetch } = useConventions(repoId, filter);
  const approvedQuery = useConventions(repoId, { status: "approved" });
  const extract = useExtractConventions(repoId);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const approvedCount = approvedQuery.data?.length ?? 0;

  const setTab = (next: Tab) => {
    const sp = new URLSearchParams(search.toString());
    sp.set("status", next);
    router.replace(`/repos/${repoId}/conventions?${sp.toString()}`);
  };

  const onExtract = () => {
    extract.mutate(undefined, {
      onSuccess: (r) =>
        toast.success(`Found ${r.candidatesCount} candidates (${r.droppedCount} dropped)`),
      onError: (err) =>
        toast.error(err instanceof ApiError ? err.message : "Extraction failed"),
    });
  };

  const repoName = activeRepo?.full_name ?? repoId;

  if (repoNotFound) {
    return (
      <AppShell crumb={[{ label: repoName, mono: true }, { label: "Conventions" }]}>
        <RepoNotFound />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={[{ label: repoName, mono: true }, { label: "Conventions" }]}>
      <div style={s.pageHeader}>
        <div>
          <h1 style={s.pageTitle}>Conventions</h1>
          <p style={s.pageSubtitle}>
            Project-local conventions extracted from configs and sample files.
          </p>
        </div>
        <div>
          <Button
            kind="primary"
            icon="Sparkles"
            onClick={onExtract}
            loading={extract.isPending}
            disabled={extract.isPending}
          >
            Run analysis
          </Button>
        </div>
      </div>

      <div style={s.tabsRow}>
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            style={s.tab(tab === t.key)}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={s.list}>
        {isLoading ? (
          <div style={s.loadingStack}>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <Skeleton key={i} height={120} />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Could not load conventions"
            body={error instanceof ApiError ? error.message : "Unexpected error"}
            onRetry={() => refetch()}
          />
        ) : (data ?? []).length === 0 ? (
          <EmptyState
            icon="Sparkles"
            title="No conventions yet"
            body="Click Run analysis to extract conventions from this repo."
          />
        ) : (
          (data ?? []).map((c) => (
            <ConventionCandidateCard key={c.id} candidate={c} repoId={repoId} />
          ))
        )}
      </div>

      <div style={s.stickyBar}>
        <Button
          kind="primary"
          icon="Sparkles"
          onClick={() => setDialogOpen(true)}
          disabled={approvedCount === 0 || approvedQuery.isLoading}
        >
          Create skill from approved ({approvedCount})
        </Button>
      </div>

      <BuildSkillDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        repoId={repoId}
        approvedCount={approvedCount}
      />
    </AppShell>
  );
}
