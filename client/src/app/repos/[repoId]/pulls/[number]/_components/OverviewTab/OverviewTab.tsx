"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { PrBriefCard } from "../PrBriefCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Needed by PrBriefCard, IntentCard, and BlastRadiusCard; cards are omitted until the PR id is known. */
  prId?: string | null;
}

// Mount chain: PRDetailPage (page.tsx) → PRDetailPageInner → OverviewTab → PrBriefCard
export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
      {/* PR Why + Risk Brief — rendered FIRST, above the Intent+Blast grid (AC-13) */}
      {prId && <PrBriefCard prId={prId} />}

      {/* Two-column card grid: Intent (left) + Blast Radius (right) */}
      {prId && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
            alignItems: "start",
          }}
        >
          <IntentCard prId={prId} />
          <BlastRadiusCard prId={prId} />
        </div>
      )}

      {prBody && (
        <section>
          <SectionLabel icon="MessageSquare">Description</SectionLabel>
          <div style={s.descriptionBox}>{prBody}</div>
        </section>
      )}
    </>
  );
}
