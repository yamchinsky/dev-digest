"use client";

import React from "react";
import { SectionLabel } from "@devdigest/ui";
import { IntentCard } from "../IntentCard";
import { BlastRadiusCard } from "../BlastRadiusCard/BlastRadiusCard";
import { s } from "./styles";

interface OverviewTabProps {
  prBody: string | null | undefined;
  /** Needed by the IntentCard and BlastRadiusCard; the cards are omitted until the PR id is known. */
  prId?: string | null;
}

export function OverviewTab({ prBody, prId }: OverviewTabProps) {
  return (
    <>
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
