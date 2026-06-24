/* IntentCard — shows the derived PR intent, in-scope/out-of-scope lists,
   the model that produced it, and a recompute button.
   Empty state renders when no intent has been derived yet. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Card, Badge, Button, SectionLabel, EmptyState } from "@devdigest/ui";
import { useIntent, useRecomputeIntent } from "@/lib/hooks/intent";
import { s } from "./styles";

export function IntentCard({ prId }: { prId: string }) {
  const t = useTranslations("intent");

  const { data, isLoading } = useIntent(prId);
  const recompute = useRecomputeIntent(prId);

  // A fresh POST response carries the producing model; a GET response does not.
  const [freshModel, setFreshModel] = React.useState<string | null>(null);

  function handleRecompute() {
    recompute.mutate(undefined, {
      onSuccess: (res) => setFreshModel(res.model),
    });
  }

  const intent = data?.intent ?? null;
  const producingModel = freshModel;

  if (isLoading) {
    return (
      <Card style={s.card}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <div style={s.loadingText} />
      </Card>
    );
  }

  if (!intent) {
    return (
      <Card style={s.card}>
        <SectionLabel icon="Sparkles">{t("title")}</SectionLabel>
        <EmptyState
          icon="Sparkles"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          cta={t("deriveButton")}
          onCta={handleRecompute}
          ctaLoading={recompute.isPending}
        />
      </Card>
    );
  }

  return (
    <Card style={s.card}>
      <SectionLabel
        icon="Sparkles"
        right={
          <Button
            kind="ghost"
            size="sm"
            icon="RefreshCw"
            loading={recompute.isPending}
            onClick={handleRecompute}
          >
            {t("recomputeButton")}
          </Button>
        }
      >
        {t("title")}
      </SectionLabel>

      {/* Intent text */}
      <p style={s.intentText}>{intent.intent}</p>

      {/* Model badge — only shown after a fresh recompute */}
      {producingModel && (
        <div style={s.modelRow}>
          <Badge icon="Cpu" color="var(--text-muted)" bg="var(--bg-hover)">
            {t("producedBy", { model: producingModel })}
          </Badge>
        </div>
      )}

      <div style={s.scopeGrid}>
        {/* In scope */}
        {intent.in_scope.length > 0 && (
          <div>
            <div style={s.scopeLabel}>{t("inScope")}</div>
            <ul style={s.scopeList}>
              {intent.in_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <span style={s.scopeDot} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Out of scope */}
        {intent.out_of_scope.length > 0 && (
          <div>
            <div style={s.scopeLabel}>{t("outOfScope")}</div>
            <ul style={s.scopeList}>
              {intent.out_of_scope.map((item, i) => (
                <li key={i} style={s.scopeItem}>
                  <span style={{ ...s.scopeDot, background: "var(--text-muted)" }} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  );
}
