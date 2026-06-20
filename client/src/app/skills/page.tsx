import { SkillsListView } from "./_components/SkillsListView";

/* Route: /skills (Skills Lab — list page). Thin route entry; the view, its
   import dialog, card, and side preview drawer are colocated under
   _components/SkillsListView/. */
export default function SkillsPage() {
  return <SkillsListView />;
}
