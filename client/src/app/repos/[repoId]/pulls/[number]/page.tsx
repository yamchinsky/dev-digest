/* PR Detail — /repos/:repoId/pulls/:number. Thin shell: orchestration lives
   in `_hooks/usePrDetailPage`; tabs render their own content; delete-run
   confirmation uses the vendored Modal instead of window.confirm. */
"use client";

import React, { Suspense } from "react";
import { useParams } from "next/navigation";
import { Skeleton, ErrorState, Modal, Button } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { RepoNotFound } from "@/components/repo-not-found";
import { PrDetailHeader } from "./_components/PrDetailHeader";
import { OverviewTab } from "./_components/OverviewTab";
import { FindingsTab } from "./_components/FindingsTab";
import { DiffTab } from "./_components/DiffTab";
import RunTraceDrawer from "./_components/RunTraceDrawer";
import { ApiError } from "@/services/api";
import { githubPrUrl } from "@/utils/github-urls";
import { usePrDetailPage } from "./_hooks/usePrDetailPage";

function LoadingShell({ crumb }: { crumb: { label: string; mono?: boolean; href?: string }[] }) {
  return (
    <AppShell crumb={crumb}>
      <div style={{ padding: "28px 32px", display: "flex", flexDirection: "column", gap: 16, maxWidth: 1080, margin: "0 auto" }}>
        <Skeleton height={28} width={420} />
        <Skeleton height={16} width={300} />
        <Skeleton height={200} />
      </div>
    </AppShell>
  );
}

function PRDetailPageInner() {
  const params = useParams<{ repoId: string; number: string }>();
  const { repoId, number } = params;
  const {
    repoNotFound,
    isLoading,
    isError,
    error,
    refetch,
    pr,
    prId,
    runs,
    prRuns,
    repoName,
    repoFullName,
    findingsCount,
    liveRunIds,
    reviewRunning,
    tab,
    traceRunId,
    setTab,
    openTrace,
    closeTrace,
    cancel,
    deleteRun,
    refetchReviews,
    invalidateActiveRuns,
    invalidateRunHistory,
  } = usePrDetailPage(repoId, number);

  // Delete-run confirmation modal: id of the run to confirm, or null.
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null);
  const confirmDelete = () => {
    if (pendingDeleteId) deleteRun.mutate(pendingDeleteId);
    setPendingDeleteId(null);
  };

  const crumb = [
    { label: repoName, mono: true, href: `/repos/${repoId}/pulls` },
    { label: "Pull Requests", href: `/repos/${repoId}/pulls` },
    { label: `#${number}`, mono: true },
  ];

  // Stale/unknown :repoId → friendly empty state instead of a 404 error.
  if (repoNotFound) {
    return (
      <AppShell crumb={crumb}>
        <RepoNotFound />
      </AppShell>
    );
  }
  if (isLoading) return <LoadingShell crumb={crumb} />;
  if (isError || !pr) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this pull request"
          body={error instanceof ApiError ? error.message : `PR #${number} could not be loaded.`}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <PrDetailHeader
        pr={pr}
        prId={prId}
        tab={tab}
        findingsCount={findingsCount}
        githubUrl={repoFullName ? githubPrUrl(repoFullName, pr.number) : null}
        onSetTab={setTab}
        onRunStart={() => setTab("findings")}
        onRunsStarted={() => invalidateActiveRuns()}
      />

      <div style={{ padding: "24px 32px 44px", display: "flex", flexDirection: "column", gap: 24, maxWidth: 1080, margin: "0 auto" }}>
        {tab === "overview" && <OverviewTab prBody={pr.body} />}

        {tab === "findings" && (
          <FindingsTab
            prId={prId}
            liveRunIds={liveRunIds}
            reviewRunning={reviewRunning}
            runs={runs}
            prRuns={prRuns}
            prCommits={pr.commits}
            repoFullName={repoFullName}
            headSha={pr.head_sha}
            cancelMutation={cancel}
            onOpenTrace={openTrace}
            onDelete={setPendingDeleteId}
            onRunDone={() => {
              invalidateActiveRuns();
              invalidateRunHistory();
              refetchReviews();
            }}
          />
        )}

        {tab === "diff" && (
          <DiffTab
            prId={prId}
            filesCount={pr.files_count}
            files={pr.files}
            canComment={pr.status === "open"}
          />
        )}
      </div>

      {prId && traceRunId && (
        <RunTraceDrawer
          runId={traceRunId}
          prNumber={pr.number}
          findings={runs.find((r) => r.run_id === traceRunId)?.findings ?? []}
          agentName={runs.find((r) => r.run_id === traceRunId)?.agent_name ?? null}
          onClose={closeTrace}
        />
      )}

      {pendingDeleteId && (
        <Modal
          width={420}
          title="Delete this run?"
          subtitle="The run and its logs are removed from history. This cannot be undone."
          onClose={() => setPendingDeleteId(null)}
          footer={
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button kind="ghost" onClick={() => setPendingDeleteId(null)}>
                Cancel
              </Button>
              <Button kind="danger" icon="Trash" onClick={confirmDelete}>
                Delete
              </Button>
            </div>
          }
        />
      )}
    </AppShell>
  );
}

export default function PRDetailPage() {
  // <Suspense> avoids the CSR bailout that useSearchParams (used in the inner
  // hook) would otherwise trigger for the entire route tree.
  return (
    <Suspense fallback={<LoadingShell crumb={[{ label: "DevDigest" }]} />}>
      <PRDetailPageInner />
    </Suspense>
  );
}
