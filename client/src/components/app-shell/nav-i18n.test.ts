/* nav-i18n.test.ts — guards the sidebar nav ↔ i18n contract.
   The command palette and sidebar resolve every nav item's label via
   t(`nav.${item.key}`) under the `shell` namespace. Adding a nav item to
   nav.ts without the matching shell.json key throws MISSING_MESSAGE at
   runtime — invisible to tsc and to component tests that don't mount the
   command palette. This test fails fast on that drift. */

import { describe, it, expect } from "vitest";
import { NAV } from "@/vendor/ui/nav";
import shellMessages from "../../../messages/en/shell.json";

describe("sidebar nav ↔ shell i18n", () => {
  const navLabels = shellMessages.nav as Record<string, string>;

  it("every NAV item key has a shell.nav.<key> label", () => {
    const missing = NAV.flatMap((g) => g.items)
      .map((it) => it.key)
      .filter((key) => !(key in navLabels));
    expect(missing).toEqual([]);
  });
});
