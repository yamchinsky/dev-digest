import { useTranslations } from "next-intl";
import { Badge, Icon, CircularScore } from "@devdigest/ui";
import type { RunSummary } from "@devdigest/shared";
import { RunCostBadge } from "@/components/RunCostBadge";
import { outcomeOf } from "../helpers";
import { s } from "../styles";

export function RunRow({
  run,
  onOpenTrace,
  onGoToReview,
  onDelete,
}: {
  run: RunSummary;
  onOpenTrace: (runId: string) => void;
  onGoToReview?: (runId: string) => void;
  onDelete?: (runId: string) => void;
}) {
  const t = useTranslations("prReview");
  const o = outcomeOf(run);
  const settled = run.status === "done";

  return (
    <div style={s.row}>
      <Badge color={o.color} bg={o.bg} icon={o.icon}>
        {t(`runStatus.${o.key}`)}
      </Badge>
      {settled && run.score != null && <CircularScore score={run.score} size={30} stroke={3} />}
      <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
          <button
            type="button"
            onClick={() => onGoToReview?.(run.run_id)}
            title={t("timeline.goToReview")}
            style={{
              background: "none",
              border: "none",
              padding: 0,
              font: "inherit",
              fontWeight: 600,
              color: "var(--text-primary)",
              cursor: onGoToReview ? "pointer" : "default",
              textDecoration: onGoToReview ? "underline" : "none",
              textDecorationStyle: "dotted",
              textUnderlineOffset: 3,
            }}
          >
            {run.agent_name ?? "Agent"}
          </button>{" "}
          <span className="mono" style={{ fontSize: 12, fontWeight: 400, color: "var(--text-muted)" }}>
            {run.provider}/{run.model}
          </span>
        </div>
        {run.status === "failed" && run.error && (
          <div
            style={{ fontSize: 12, color: "var(--crit)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            title={run.error}
          >
            {run.error}
          </div>
        )}
        {settled && (
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {t("runStatus.findings", { count: run.findings_count ?? 0 })}
            {(run.blockers ?? 0) > 0 ? t("runStatus.blockers", { count: run.blockers ?? 0 }) : ""}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
        {settled && (
          <RunCostBadge
            cost={run.cost_usd}
            tokensIn={run.tokens_in}
            tokensOut={run.tokens_out}
            variant="full"
          />
        )}
        {run.ran_at && <span>{new Date(run.ran_at).toLocaleTimeString()}</span>}
      </div>
      <button
        type="button"
        title={t("timeline.openTrace")}
        aria-label={t("timeline.openTrace")}
        onClick={() => onOpenTrace(run.run_id)}
        style={s.iconBtn}
      >
        <Icon.FileText size={13} />
      </button>
      {onDelete && run.status !== "running" && (
        <span
          role="button"
          aria-label={t("timeline.deleteRun")}
          title={t("timeline.deleteRun")}
          onClick={() => onDelete(run.run_id)}
          style={s.deleteBtn}
        >
          <Icon.Trash size={13} />
        </span>
      )}
    </div>
  );
}
