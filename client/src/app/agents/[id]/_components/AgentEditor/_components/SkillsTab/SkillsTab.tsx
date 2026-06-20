/* SkillsTab — agent ↔ skills binding tab.
 *
 *  Semantics: a checkbox = "this skill is linked to this agent" (linking ==
 *  enabling for this agent). The skill's workspace-level `enabled` toggle
 *  lives on the Skills Lab page; if the user disables a skill globally, it
 *  won't be included in any run even if linked here (the server filters in
 *  run-executor).
 *
 *  Linked skills are draggable; the order they appear here is the order
 *  assemblePrompt() injects them into the prompt. Unlinked skills float to
 *  the bottom (alphabetical) and become draggable as soon as they're checked.
 */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  PointerSensor,
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
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Checkbox, Icon, Skeleton, ErrorState } from "@devdigest/ui";
import type { Agent, Skill } from "@devdigest/shared";
import { useSkills, useAgentSkills, useSetAgentSkills } from "@/lib/hooks/skills";
import { typeColor } from "@/app/skills/_components/SkillsListView/helpers";
import { s } from "./styles";

function SortableRow({
  skill,
  linked,
  onToggle,
  draggable,
}: {
  skill: Skill;
  linked: boolean;
  onToggle: () => void;
  draggable: boolean;
}) {
  const sortable = useSortable({ id: skill.id, disabled: !draggable });
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = sortable;
  const t = useTranslations("skills");

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...s.row(linked, isDragging),
  };

  return (
    <div ref={setNodeRef} style={style}>
      <span
        style={{ ...s.handle, cursor: draggable ? "grab" : "default", opacity: draggable ? 1 : 0.35 }}
        {...(draggable ? attributes : {})}
        {...(draggable ? listeners : {})}
        aria-label="Drag to reorder"
      >
        <Icon.Menu size={14} />
      </span>
      <Checkbox checked={linked} onChange={onToggle} />
      <span style={s.name}>{skill.name}</span>
      <span style={s.typeBadge(typeColor(skill.type))}>{t(`listItem.type.${skill.type}`)}</span>
    </div>
  );
}

export function SkillsTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const ts = useTranslations("skills");
  const { data: allSkills, isLoading: loadingAll, isError: errorAll, refetch: refetchAll } = useSkills();
  const { data: links, isLoading: loadingLinks, isError: errorLinks, refetch: refetchLinks } = useAgentSkills(agent.id);
  const setSkills = useSetAgentSkills();
  const [filter, setFilter] = React.useState("");

  // Single source of truth for ORDER: the local `orderedLinkedIds` array. We
  // hydrate it from the server's `links` once and on agent change; subsequent
  // local edits (toggle / drag) update it immediately and fire a mutation —
  // the server then echoes the same array back, so the hydrate noop'd.
  const [orderedLinkedIds, setOrderedLinkedIds] = React.useState<string[]>([]);
  const hydratedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!links) return;
    if (hydratedFor.current === agent.id) return;
    setOrderedLinkedIds(links.map((l) => l.skill_id));
    hydratedFor.current = agent.id;
  }, [links, agent.id]);

  const skillsById = React.useMemo(() => {
    const map = new Map<string, Skill>();
    for (const sk of allSkills ?? []) map.set(sk.id, sk);
    return map;
  }, [allSkills]);

  // Display order: linked (in their ordered sequence) then unlinked
  // (alphabetical). The drag interaction reorders ONLY the linked group;
  // the SortableContext below is scoped to the linked ids.
  const linkedDisplay = orderedLinkedIds.map((id) => skillsById.get(id)).filter((x): x is Skill => !!x);
  const unlinkedDisplay = (allSkills ?? [])
    .filter((sk) => !orderedLinkedIds.includes(sk.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const needle = filter.trim().toLowerCase();
  const visible = (sk: Skill) =>
    !needle || sk.name.toLowerCase().includes(needle) || sk.description.toLowerCase().includes(needle);

  const totalCount = allSkills?.length ?? 0;
  const linkedCount = orderedLinkedIds.length;

  function persist(next: string[]) {
    setOrderedLinkedIds(next);
    setSkills.mutate({ agentId: agent.id, skillIds: next });
  }

  function toggleLink(id: string) {
    if (orderedLinkedIds.includes(id)) {
      persist(orderedLinkedIds.filter((x) => x !== id));
    } else {
      persist([...orderedLinkedIds, id]);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = orderedLinkedIds.indexOf(String(active.id));
    const to = orderedLinkedIds.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    persist(arrayMove(orderedLinkedIds, from, to));
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  if (loadingAll || loadingLinks) {
    return (
      <div style={s.wrap}>
        <Skeleton height={240} />
      </div>
    );
  }
  if (errorAll || errorLinks) {
    return (
      <div style={s.wrap}>
        <ErrorState
          body="Could not load skills."
          onRetry={() => {
            refetchAll();
            refetchLinks();
          }}
        />
      </div>
    );
  }

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.title}>{t("skills.title")}</div>
        <span style={s.enabledBadge}>
          {t("skills.enabledCount", { linked: linkedCount, total: totalCount })}
        </span>
        <div style={s.search}>
          <Icon.Search size={13} style={{ color: "var(--text-muted)" }} />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("skills.filterPlaceholder")}
            style={s.searchInput}
          />
        </div>
      </div>
      <div style={s.hint}>{t("skills.orderHint")}</div>

      {totalCount === 0 ? (
        <div style={s.empty}>{t("skills.empty")}</div>
      ) : (
        <div style={s.list}>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedLinkedIds} strategy={verticalListSortingStrategy}>
              {linkedDisplay.filter(visible).map((sk) => (
                <SortableRow
                  key={sk.id}
                  skill={sk}
                  linked
                  draggable
                  onToggle={() => toggleLink(sk.id)}
                />
              ))}
            </SortableContext>
            {unlinkedDisplay.filter(visible).map((sk) => (
              // Unlinked rows render OUTSIDE the SortableContext — they aren't
              // sortable until they get checked (and join orderedLinkedIds).
              <SortableRow
                key={sk.id}
                skill={sk}
                linked={false}
                draggable={false}
                onToggle={() => toggleLink(sk.id)}
              />
            ))}
          </DndContext>
          {/* Quietly surface the only spot a mutation error would land. The
              global error policy already toasts; this is fallback messaging
              in case the toast is missed. */}
          {setSkills.isError && (
            <div style={{ fontSize: 12, color: "var(--sev-critical, #ef4444)", marginTop: 8 }}>
              {ts("drawer.importFailed")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
