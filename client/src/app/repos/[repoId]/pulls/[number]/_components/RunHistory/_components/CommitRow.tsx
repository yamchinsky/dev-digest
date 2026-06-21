import { Icon } from "@devdigest/ui";
import type { PrCommit } from "@devdigest/shared";
import { s } from "../styles";

/** Commit marker row in the timeline — visually lighter than a run row. */
export function CommitRow({ commit }: { commit: PrCommit }) {
  return (
    <div style={s.commitRow}>
      <Icon.GitCommit size={15} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
      <span className="mono" style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
        {commit.sha.slice(0, 7)}
      </span>
      <span
        style={{
          fontSize: 12.5,
          color: "var(--text-secondary)",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={commit.message}
      >
        {commit.message.split("\n")[0]}
      </span>
      <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{commit.author}</span>
      {commit.committed_at && (
        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
          {new Date(commit.committed_at).toLocaleTimeString()}
        </span>
      )}
    </div>
  );
}
