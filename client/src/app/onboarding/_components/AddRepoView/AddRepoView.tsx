/* AddRepoView — add-repository screen body. URL only. API keys (OpenAI /
   Anthropic / GitHub PAT) are NOT entered here; they live in Settings → API
   Keys and don't change per repo. Escapable: Esc or the close button returns
   to the app. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { Button, Icon, IconBtn, Kbd, TextInput, FormField } from "@devdigest/ui";
import { useAddRepo } from "@/lib/hooks";
import { ApiError } from "@/services/api";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { s } from "./styles";

export function AddRepoView() {
  const router = useRouter();
  const [repoUrl, setRepoUrl] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const addRepo = useAddRepo();

  const close = React.useCallback(() => router.push("/"), [router]);
  // Escapable (the footer advertises Esc — make it real).
  useEscapeKey(close);

  const submit = async () => {
    if (!repoUrl.trim()) return;
    setError(null);
    try {
      const repo = await addRepo.mutateAsync(repoUrl.trim());
      router.push(`/repos/${repo.id}/pulls`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not add repository");
    }
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <div style={s.logoBox}>
          <Icon.Layers size={17} style={{ color: "var(--bg-primary)" }} />
        </div>
        <span style={s.logoText}>DevDigest</span>
      </div>

      <div style={s.card}>
        <div style={s.closeBtn}>
          <IconBtn icon="X" label="Close" onClick={close} />
        </div>

        <h1 style={s.title}>Add a repository</h1>
        <p style={s.description}>
          Paste a GitHub repository URL — DevDigest clones it locally and imports open PRs.
          API keys aren’t needed here; set them once in{" "}
          <a
            href="/settings/api-keys"
            onClick={(e) => {
              e.preventDefault();
              router.push("/settings/api-keys");
            }}
            style={{ color: "var(--accent-text)" }}
          >
            Settings → API Keys
          </a>
          .
        </p>

        <FormField label="Repository URL" hint="e.g. https://github.com/acme/payments-api">
          <TextInput
            value={repoUrl}
            onChange={setRepoUrl}
            mono
            placeholder="https://github.com/owner/repo"
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
          />
        </FormField>

        {error && (
          <div style={s.errorBox}>
            <Icon.XCircle size={16} style={{ color: "var(--crit)" }} />
            <span style={s.errorText}>{error}</span>
          </div>
        )}

        <div style={s.actions}>
          <Button kind="ghost" size="md" onClick={close}>
            Cancel
          </Button>
          <div style={{ flex: 1 }} />
          <Button
            kind="primary"
            size="md"
            icon="Plus"
            onClick={submit}
            disabled={!repoUrl.trim() || addRepo.isPending}
          >
            {addRepo.isPending ? "Cloning…" : "Add repository"}
          </Button>
        </div>
      </div>

      <p style={s.footer}>
        <Icon.Lock size={12} /> API keys live in Settings · <Kbd>esc</Kbd> to close
      </p>
    </div>
  );
}
