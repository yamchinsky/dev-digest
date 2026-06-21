import { SkillEditor } from "../_components/SkillEditor";

/* /skills/new — Create a new skill from scratch (manual source).
   On save, navigates to /skills/[id] of the just-created row. */
export default function NewSkillPage() {
  return <SkillEditor mode="create" />;
}
