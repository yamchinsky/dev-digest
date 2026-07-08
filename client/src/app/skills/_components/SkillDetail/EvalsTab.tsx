/* EvalsTab — Skills Lab benchmark per skill (the "Skill Editor · Evals" design).
 *
 *  Answers "is this skill worth its tokens?" by running the SAME benchmark
 *  cases twice — WITH the skill body injected and with the bare model — and
 *  comparing. Grading is code-only (patterns over the output), never a judge,
 *  so runs across skill versions stay comparable.
 *
 *  Layout mirrors the design: a with_skill/without_skill/Δ summary table
 *  (pass rate, duration, tokens) on top, a per-case qualitative diff below,
 *  then run history. Data comes from GET /skills/:id/benchmarks; the seeded
 *  demo run means the tab is populated even with no API key configured. */
"use client";

import { useTranslations } from "next-intl";
import { Button, Skeleton, ErrorState, EmptyState, Icon, Badge } from "@devdigest/ui";
import type { Skill, SkillBenchmarkRun, SkillBenchmarkMetrics } from "@devdigest/shared";
import { useSkillBenchmarks, useStartSkillBenchmark } from "@/lib/hooks/skills";
import { s } from "./styles";
import { e } from "./evals-styles";

export function EvalsTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const { data: runs, isLoading, isError, refetch } = useSkillBenchmarks(skill.id);
  const start = useStartSkillBenchmark(skill.id);

  const isRunning = start.isPending || (runs ?? []).some((r) => r.status === "running");
  const latestDone = (runs ?? []).find((r) => r.status === "done");
  const lastFailed = (runs ?? []).find((r) => r.status === "failed" && r === (runs ?? [])[0]);

  return (
    <div style={s.pane}>
      <div style={e.headerRow}>
        <div style={s.sectionTitle}>{t("benchmark.title")}</div>
        <div style={{ flex: 1 }} />
        <Button
          kind="primary"
          size="sm"
          icon="Play"
          disabled={isRunning}
          loading={isRunning}
          onClick={() => start.mutate({})}
        >
          {isRunning ? t("benchmark.running") : t("benchmark.run")}
        </Button>
      </div>

      {isLoading && <Skeleton height={160} />}
      {isError && <ErrorState body={t("benchmark.loadError")} onRetry={() => refetch()} />}

      {!isLoading && !isError && (
        <>
          {isRunning && !latestDone && (
            <div style={e.notice}>
              <Icon.Clock size={13} /> {t("benchmark.status.running")}
            </div>
          )}

          {lastFailed && !latestDone && (
            <div style={e.error}>
              <Icon.AlertTriangle size={13} />{" "}
              {t("benchmark.failed", { error: lastFailed.error ?? "unknown" })}
            </div>
          )}

          {!latestDone && !isRunning && !lastFailed && (
            <EmptyState
              icon="BarChart"
              title={t("benchmark.empty.title")}
              body={t("benchmark.empty.body")}
            />
          )}

          {latestDone && <BenchmarkResult run={latestDone} />}

          {(runs ?? []).length > 0 && (
            <>
              <div style={{ height: 28 }} />
              <div style={s.sectionTitle}>{t("benchmark.history")}</div>
              <div style={e.historyList}>
                {(runs ?? []).map((r) => (
                  <RunRow key={r.id} run={r} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function BenchmarkResult({ run }: { run: SkillBenchmarkRun }) {
  const t = useTranslations("skills");
  const w = run.with_skill;
  const wo = run.without_skill;
  if (!w || !wo) return null;

  return (
    <>
      {/* Summary: Metric | with_skill | without_skill | Δ */}
      <div style={e.table}>
        <div style={e.headCell}>{t("benchmark.col.metric")}</div>
        <div style={e.headCell}>with_skill</div>
        <div style={e.headCell}>without_skill</div>
        <div style={e.headCell}>{t("benchmark.col.delta")}</div>

        <MetricRow
          label={t("benchmark.metric.passRate")}
          withText={passRate(w)}
          withoutText={passRate(wo)}
          delta={signedPct(w.pass_rate - wo.pass_rate)}
          deltaGood={w.pass_rate - wo.pass_rate >= 0}
        />
        <MetricRow
          label={t("benchmark.metric.duration")}
          withText={secs(w.duration_ms)}
          withoutText={secs(wo.duration_ms)}
          delta={signedSecs(w.duration_ms - wo.duration_ms)}
        />
        <MetricRow
          label={t("benchmark.metric.tokens")}
          withText={num(w.tokens)}
          withoutText={num(wo.tokens)}
          delta={signedNum(w.tokens - wo.tokens)}
        />
      </div>

      {/* Qualitative diff per case */}
      {run.cases.length > 0 && (
        <>
          <div style={{ height: 24 }} />
          <div style={s.sectionTitle}>{t("benchmark.qualitative")}</div>
          {run.cases.map((c) => (
            <div key={c.name} style={e.caseBlock}>
              <div style={e.caseName}>{c.name}</div>
              <div style={e.aspectTable}>
                <div style={e.headCell}>{t("benchmark.col.aspect")}</div>
                <div style={e.headCell}>with_skill</div>
                <div style={e.headCell}>without_skill</div>
                {c.aspects.map((a, i) => (
                  <div key={i} style={{ display: "contents" }}>
                    <div style={e.aspectCell}>{a.aspect}</div>
                    <div style={e.aspectCell}>
                      <PassMark pass={a.with_pass} /> {a.with_skill}
                    </div>
                    <div style={e.aspectCell}>
                      <PassMark pass={a.without_pass} /> {a.without_skill}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </>
  );
}

function MetricRow({
  label,
  withText,
  withoutText,
  delta,
  deltaGood,
}: {
  label: string;
  withText: string;
  withoutText: string;
  delta: string;
  deltaGood?: boolean;
}) {
  return (
    <>
      <div style={e.cell}>{label}</div>
      <div style={e.cellStrong}>{withText}</div>
      <div style={e.cellStrong}>{withoutText}</div>
      <div style={{ ...e.cell, color: deltaGood === undefined ? "var(--accent)" : deltaGood ? "var(--sev-ok, #10b981)" : "var(--sev-warning, #f59e0b)" }}>
        {delta}
      </div>
    </>
  );
}

function RunRow({ run }: { run: SkillBenchmarkRun }) {
  const t = useTranslations("skills");
  const color =
    run.status === "done"
      ? "var(--sev-ok, #10b981)"
      : run.status === "failed"
        ? "var(--sev-critical, #ef4444)"
        : "var(--text-muted)";
  return (
    <div style={e.historyRow}>
      <Badge color={color}>{run.status}</Badge>
      <span style={e.historyModel}>{run.model}</span>
      {run.skill_version != null && (
        <span style={e.historyVersion}>v{run.skill_version}</span>
      )}
      <div style={{ flex: 1 }} />
      {run.with_skill && run.without_skill ? (
        <span style={e.historyMetric}>
          {t("benchmark.metric.passRate")}: {passRate(run.with_skill)} /{" "}
          {passRate(run.without_skill)}
        </span>
      ) : (
        <span style={e.historyMetric}>{run.error ?? "—"}</span>
      )}
    </div>
  );
}

function PassMark({ pass }: { pass: boolean }) {
  return pass ? (
    <Icon.Check size={12} style={{ color: "var(--sev-ok, #10b981)" }} />
  ) : (
    <Icon.X size={12} style={{ color: "var(--text-muted)" }} />
  );
}

// ---- Formatters ------------------------------------------------------------

function passRate(m: SkillBenchmarkMetrics): string {
  return `${Math.round(m.pass_rate * 100)}% (${m.checks_passed}/${m.checks_total})`;
}
function secs(ms: number): string {
  return `~${Math.round(ms / 1000)} s`;
}
function num(n: number): string {
  return n.toLocaleString("en-US");
}
function signedPct(delta: number): string {
  const v = Math.round(delta * 100);
  return `${v >= 0 ? "+" : ""}${v}%`;
}
function signedSecs(deltaMs: number): string {
  const v = Math.round(deltaMs / 1000);
  return `${v >= 0 ? "+" : ""}${v} s`;
}
function signedNum(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta.toLocaleString("en-US")}`;
}
