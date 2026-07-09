/* Route: /ci-runs — global CI runs dashboard (cross-repo, not per-repo). */
import type { Metadata } from "next";
import { CiRunsPage } from "./_components/CiRunsPage";

export const metadata: Metadata = {
  title: "CI Runs · DevDigest",
};

export default function CiRunsRoute() {
  return <CiRunsPage />;
}
