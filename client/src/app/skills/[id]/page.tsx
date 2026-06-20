"use client";

import { useParams } from "next/navigation";
import { SkillEditor } from "../_components/SkillEditor";

/* /skills/[id] — Edit an existing skill. Body change creates a new immutable
   version (server-side); other field changes don't bump version. */
export default function SkillPage() {
  const params = useParams<{ id: string }>();
  return <SkillEditor mode="edit" skillId={params.id} />;
}
