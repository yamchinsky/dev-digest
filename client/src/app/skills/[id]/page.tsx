"use client";

import { useParams } from "next/navigation";
import { SkillsLab } from "../_components/SkillsLab";

/* /skills/[id] — same Skills Lab shell, with one skill selected and loaded
 *  in the right pane. Saved tab state lives in ?tab=. */
export default function SkillDetailPage() {
  const params = useParams<{ id: string }>();
  return <SkillsLab skillId={params.id} />;
}
