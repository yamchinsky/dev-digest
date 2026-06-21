/* PreviewTab — full-bleed rendered markdown of the skill body, exactly as the
 *  reviewer-core prompt will inject it under "## Skills / rules". Useful for
 *  spot-checking complex markdown without scrolling between Edit and Preview
 *  inside the body textarea. */
"use client";

import { Markdown } from "@devdigest/ui";
import type { Skill } from "@devdigest/shared";
import { s } from "./styles";

export function PreviewTab({ skill }: { skill: Skill }) {
  return (
    <div style={s.pane}>
      <div style={s.sectionTitle}>How agents will see this</div>
      <div style={s.preview}>
        <Markdown>{skill.body}</Markdown>
      </div>
    </div>
  );
}
