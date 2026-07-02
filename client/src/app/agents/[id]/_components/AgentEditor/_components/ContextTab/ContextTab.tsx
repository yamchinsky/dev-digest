/* ContextTab — agent ↔ context-docs binding tab.
 *
 *  Semantics: a checkbox = "this doc is attached to this agent" (ordered).
 *  Attached docs are draggable; the order here is the order they're injected
 *  into the ## Project context prompt slot at run time.
 *  Unattached docs float below (alphabetical) and become draggable once checked.
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useQueries } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, Icon, Skeleton, ErrorState, Markdown, TextInput } from "@devdigest/ui";
import type { Agent, ContextDoc, ContextDocCategory } from "@devdigest/shared";
import {
  useWorkspaceContextDocs,
  useAgentContextDocs,
  useSetAgentContextDocs,
  useContextDocPreview,
} from "@/lib/hooks/context-docs";
import { api } from "@/services/api";
import type { CSSProperties } from "react";

// ── types ────────────────────────────────────────────────────────────────────

type DocRef = { repo_id: string; relative_path: string };

// ── helpers ──────────────────────────────────────────────────────────────────

/** Stable composite key used as DnD item ID and lookup map key. */
const docKey = (repo_id: string, relative_path: string) =>
  `${repo_id}:${relative_path}`;

// ── category badge ────────────────────────────────────────────────────────────

const CAT_COLOR: Record<ContextDocCategory, string> = {
  specs: "#6366f1",
  docs: "#16a34a",
  insights: "#d97706",
};

function catBadgeStyle(category: ContextDocCategory): CSSProperties {
  const color = CAT_COLOR[category];
  return {
    fontSize: 11,
    fontWeight: 600,
    color,
    background: color + "1f",
    padding: "2px 8px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    flexShrink: 0,
  };
}

// ── SortableDocRow ────────────────────────────────────────────────────────────

function SortableDocRow({
  doc,
  attached,
  draggable,
  onToggle,
}: {
  doc: ContextDoc;
  attached: boolean;
  draggable: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("agents");
  const tCtx = useTranslations("contextDocs");
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const id = docKey(doc.repo_id, doc.relative_path);
  const sortable = useSortable({ id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;

  // Preview is fetched lazily (only when the pane is open). The parent's
  // useQueries pre-warms the cache for attached docs, so the first open is
  // effectively instant — no double-fetch.
  const { data: preview, isFetching: previewLoading } = useContextDocPreview(
    previewOpen ? doc.repo_id : null,
    previewOpen ? doc.relative_path : null,
  );

  const badgeLabel =
    doc.category === "specs"
      ? tCtx("list.badge.specs")
      : doc.category === "docs"
        ? tCtx("list.badge.docs")
        : tCtx("list.badge.insights");

  return (
    <div
      ref={setNodeRef}
      style={{
        borderRadius: 7,
        border: "1px solid var(--border)",
        marginBottom: 6,
        overflow: "hidden",
        background: isDragging
          ? "var(--bg-hover)"
          : attached
            ? "var(--bg-elevated)"
            : "var(--bg-surface)",
        opacity: isDragging ? 0.85 : 1,
        boxShadow: isDragging ? "var(--shadow-modal)" : "none",
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      {/* ── main row ─────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
        <span
          style={{
            color: "var(--text-muted)",
            display: "inline-flex",
            padding: 2,
            cursor: draggable ? "grab" : "default",
            opacity: draggable ? 1 : 0.35,
          }}
          {...(draggable ? attributes : {})}
          {...(draggable ? listeners : {})}
          aria-label={t("context.dragToReorder")}
        >
          <Icon.Menu size={14} />
        </span>
        <Checkbox checked={attached} onChange={onToggle} />
        <span
          style={{
            flex: 1,
            fontSize: 13,
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
            color: "var(--text-primary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={doc.relative_path}
        >
          {doc.relative_path}
        </span>
        <span style={catBadgeStyle(doc.category)}>{badgeLabel}</span>
        <button
          type="button"
          onClick={() => setPreviewOpen((v) => !v)}
          style={{
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 4,
            border: "1px solid var(--border)",
            background: previewOpen ? "var(--accent-bg)" : "transparent",
            color: previewOpen ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            flexShrink: 0,
          }}
          aria-expanded={previewOpen}
          aria-label={previewOpen ? t("context.previewHide") : t("context.previewShow")}
        >
          {previewOpen ? t("context.previewHide") : t("context.previewShow")}
        </button>
      </div>

      {/* ── inline preview pane ──────────────────────────────────────────── */}
      {previewOpen && (
        <div
          style={{
            padding: "8px 12px 12px 36px",
            borderTop: "1px solid var(--border)",
            fontSize: 12.5,
            color: "var(--text-secondary)",
            maxHeight: 300,
            overflowY: "auto",
          }}
        >
          {previewLoading ? (
            <Skeleton height={80} />
          ) : preview ? (
            <Markdown>{preview.content}</Markdown>
          ) : (
            <span style={{ color: "var(--text-muted)", fontSize: 12 }}>—</span>
          )}
        </div>
      )}
    </div>
  );
}

// ── ContextTab ────────────────────────────────────────────────────────────────

export function ContextTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const [filter, setFilter] = React.useState("");

  const {
    data: allDocs,
    isLoading: loadingAll,
    isError: errorAll,
    refetch: refetchAll,
  } = useWorkspaceContextDocs();
  const {
    data: agentDocs,
    isLoading: loadingAgent,
    isError: errorAgent,
    refetch: refetchAgent,
  } = useAgentContextDocs(agent.id);
  const setAgentContextDocs = useSetAgentContextDocs(agent.id);

  // ── ordered attachment state ──────────────────────────────────────────────
  // Single source of truth for ORDER: the local `orderedAttached` array.
  // Hydrated once from the server's `agentDocs`; subsequent local edits
  // (toggle / drag) update it immediately and fire a mutation — the server
  // echoes the same order back, so the next hydration is a noop.
  const [orderedAttached, setOrderedAttached] = React.useState<DocRef[]>([]);
  const hydratedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!agentDocs) return;
    if (hydratedFor.current === agent.id) return;
    setOrderedAttached(
      [...agentDocs]
        .sort((a, b) => a.order - b.order)
        .map(({ repo_id, relative_path }) => ({ repo_id, relative_path })),
    );
    hydratedFor.current = agent.id;
  }, [agentDocs, agent.id]);

  // ── lookup map ────────────────────────────────────────────────────────────
  const docsById = React.useMemo(() => {
    const map = new Map<string, ContextDoc>();
    for (const doc of allDocs ?? []) {
      map.set(docKey(doc.repo_id, doc.relative_path), doc);
    }
    return map;
  }, [allDocs]);

  // ── display lists ─────────────────────────────────────────────────────────
  // Attached: preserve the drag order; skip any refs not yet in the workspace
  // snapshot (can happen briefly during optimistic updates).
  const attachedDisplay = orderedAttached
    .map(({ repo_id, relative_path }) => docsById.get(docKey(repo_id, relative_path)))
    .filter((x): x is ContextDoc => !!x);

  const attachedKeySet = new Set(
    orderedAttached.map(({ repo_id, relative_path }) => docKey(repo_id, relative_path)),
  );

  // Unattached: alphabetical by relative_path, no drag handle
  const unattachedDisplay = (allDocs ?? [])
    .filter((doc) => !attachedKeySet.has(docKey(doc.repo_id, doc.relative_path)))
    .sort((a, b) => a.relative_path.localeCompare(b.relative_path));

  // Client-side path filter — hides rows only; attachment order and the DnD
  // item registry keep operating on the full list, so a drag while filtered
  // still reorders against true positions.
  const matchesFilter = (doc: ContextDoc) =>
    !filter.trim() || doc.relative_path.includes(filter);
  const attachedVisible = attachedDisplay.filter(matchesFilter);
  const unattachedVisible = unattachedDisplay.filter(matchesFilter);

  // DnD item IDs (scoped to the attached group)
  const orderedKeys = orderedAttached.map(({ repo_id, relative_path }) =>
    docKey(repo_id, relative_path),
  );

  // ── footer token estimate ─────────────────────────────────────────────────
  // Eagerly fetch all attached doc previews.  The cache key matches the one
  // used by SortableDocRow's useContextDocPreview, so the two share data —
  // no extra network requests when a user expands a row.
  const previewQueries = useQueries({
    queries: attachedDisplay.map((doc) => ({
      queryKey: ["context-doc-preview", doc.repo_id, doc.relative_path],
      queryFn: () =>
        api.get<{ content: string }>(
          `/workspace/context-docs/preview?repoId=${encodeURIComponent(doc.repo_id)}&path=${encodeURIComponent(doc.relative_path)}`,
        ),
      staleTime: 60_000,
    })),
  });

  // Derive token count inline (O(n), n is small).
  let totalChars = 0;
  let tokenApproximate = false;
  for (const q of previewQueries) {
    if (q.data) {
      totalChars += q.data.content.length;
    } else if (!q.isError) {
      tokenApproximate = true; // still loading → show ~ prefix
    }
  }
  const tokens = Math.ceil(totalChars / 4);

  // ── counts ────────────────────────────────────────────────────────────────
  const totalCount = allDocs?.length ?? 0;
  const attachedCount = orderedAttached.length;

  // ── DnD sensors (Pointer + Keyboard for a11y) ─────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── handlers ──────────────────────────────────────────────────────────────
  function persist(next: DocRef[]) {
    setOrderedAttached(next);
    setAgentContextDocs.mutate({
      items: next.map(({ repo_id, relative_path }) => ({
        repo_id,
        path: relative_path,
      })),
    });
  }

  function toggleAttach(doc: ContextDoc) {
    const key = docKey(doc.repo_id, doc.relative_path);
    if (attachedKeySet.has(key)) {
      // Remove → full list minus this doc
      persist(
        orderedAttached.filter(
          (d) => docKey(d.repo_id, d.relative_path) !== key,
        ),
      );
    } else {
      // Append to end of ordered list
      persist([
        ...orderedAttached,
        { repo_id: doc.repo_id, relative_path: doc.relative_path },
      ]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderedKeys.indexOf(String(active.id));
    const to = orderedKeys.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    persist(arrayMove(orderedAttached, from, to));
  }

  // ── loading / error guards ────────────────────────────────────────────────
  if (loadingAll || loadingAgent) {
    return (
      <div style={{ padding: "24px 28px 44px" }}>
        <Skeleton height={240} />
      </div>
    );
  }
  if (errorAll || errorAgent) {
    return (
      <div style={{ padding: "24px 28px 44px" }}>
        <ErrorState
          body={t("context.loadError")}
          onRetry={() => {
            refetchAll();
            refetchAgent();
          }}
        />
      </div>
    );
  }

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px 28px 44px" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8 }}>
        <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em" }}>
          {t("context.title")}
        </div>
        <span
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: "3px 8px",
            borderRadius: 5,
            background: "var(--accent-bg)",
            color: "var(--accent)",
          }}
        >
          {t("context.attachedCount", { attached: attachedCount, total: totalCount })}
        </span>
        <div style={{ marginLeft: "auto", width: 240 }}>
          <TextInput
            value={filter}
            onChange={setFilter}
            placeholder={t("context.filterPlaceholder")}
          />
        </div>
      </div>
      <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("context.orderHint")}
      </div>

      {totalCount === 0 ? (
        <div
          style={{
            padding: "32px 20px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--text-muted)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {t("context.empty")}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              {/* Attached docs — sortable */}
              <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
                {attachedVisible.map((doc) => (
                  <SortableDocRow
                    key={docKey(doc.repo_id, doc.relative_path)}
                    doc={doc}
                    attached
                    draggable
                    onToggle={() => toggleAttach(doc)}
                  />
                ))}
              </SortableContext>

              {/* Unattached docs — rendered outside the SortableContext;
                  they become draggable only after being checked. */}
              {unattachedVisible.map((doc) => (
                <SortableDocRow
                  key={docKey(doc.repo_id, doc.relative_path)}
                  doc={doc}
                  attached={false}
                  draggable={false}
                  onToggle={() => toggleAttach(doc)}
                />
              ))}
            </DndContext>

            {/* Mutation error fallback (global toast already fires; this is a
                belt-and-suspenders message in case the toast is missed). */}
            {setAgentContextDocs.isError && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--sev-critical, #ef4444)",
                  marginTop: 8,
                }}
              >
                {t("context.saveFailed")}
              </div>
            )}
          </div>

          {/* footer — token estimate for the ## Project context slot */}
          {attachedCount > 0 && (
            <div
              style={{
                marginTop: 16,
                padding: "10px 14px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                background: "var(--bg-surface)",
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <code
                style={{
                  fontFamily:
                    "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  background: "var(--bg-hover)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                {t("context.tokenFooterLabel")}
              </code>
              <span>
                {tokenApproximate ? "~" : ""}
                {tokens} {t("context.tokenUnit")}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
