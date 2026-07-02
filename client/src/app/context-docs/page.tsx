/* Route: /context-docs — Project Context (2-pane). Thin route entry; the list
   and preview panes are colocated under _components/. Selection state lives here
   so both panes can share it without prop-drilling through a common parent. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { AppShell } from "@/components/app-shell";
import { ContextDocsList } from "./_components/ContextDocsList";
import { ContextDocsPreview } from "./_components/ContextDocsPreview";

type SelectedDoc = { repoId: string; path: string };

export default function ContextDocsPage() {
  const t = useTranslations("contextDocs");
  const [selected, setSelected] = React.useState<SelectedDoc | null>(null);

  return (
    <AppShell crumb={[{ label: t("title") }]}>
      <div
        style={{
          display: "flex",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {/* left: list ~40% */}
        <div
          style={{
            flex: "0 0 40%",
            minWidth: 0,
            borderRight: "1px solid var(--border)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <ContextDocsList selected={selected} onSelect={setSelected} />
        </div>

        {/* right: preview ~60% — keyed by doc so tab/draft state resets on switch */}
        <div
          style={{
            flex: "0 0 60%",
            minWidth: 0,
            overflow: "auto",
          }}
        >
          <ContextDocsPreview
            key={selected ? `${selected.repoId}:${selected.path}` : "none"}
            selected={selected}
          />
        </div>
      </div>
    </AppShell>
  );
}
