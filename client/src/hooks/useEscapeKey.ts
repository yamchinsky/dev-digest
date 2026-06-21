"use client";

import { useEffect } from "react";

/** Run a callback when the user presses Escape anywhere on the page.
    Used by modal-like screens (e.g. onboarding/AddRepoView) to close on Esc. */
export function useEscapeKey(onEscape: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onEscape]);
}
