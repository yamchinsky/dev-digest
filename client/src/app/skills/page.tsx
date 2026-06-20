import { SkillsLab } from "./_components/SkillsLab";

/* Route: /skills — Skills Lab (3-pane). Thin route entry; the layout, its
 *  import dialog, card list, and detail tabs are colocated under
 *  _components/. With no skill selected the right pane shows an empty state. */
export default function SkillsPage() {
  return <SkillsLab />;
}
