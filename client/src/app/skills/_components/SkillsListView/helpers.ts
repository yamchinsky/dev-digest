import type { Skill, SkillType } from "@devdigest/shared";

/** Case-insensitive substring match on name + description (client-side; the
 *  server already accepts ?q= but we re-filter to avoid round-tripping on
 *  every keystroke). */
export function filterSkills(skills: Skill[], q: string): Skill[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return skills;
  return skills.filter(
    (s) =>
      s.name.toLowerCase().includes(needle) || s.description.toLowerCase().includes(needle),
  );
}

/** Map a SkillType to a CSS color variable. Matches the design's badge palette
 *  (security = red, rubric = blue/accent, convention = green, custom = gray). */
export function typeColor(type: SkillType): string {
  switch (type) {
    case "security":
      return "var(--sev-critical, #ef4444)";
    case "rubric":
      return "var(--accent, #6366f1)";
    case "convention":
      return "var(--sev-ok, #10b981)";
    case "custom":
    default:
      return "var(--text-secondary, #94a3b8)";
  }
}
