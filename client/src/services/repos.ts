/* repos.ts — server-side data access for repos. Used by Server Components
   that need to fetch repos at render time (e.g. the root page redirect).
   Client code keeps using the React Query hook `useRepos()` in `lib/hooks`. */
import { api } from "./api";
import type { Repo } from "@/types";

/** Server-safe: returns the repos list (empty array on API failure). */
export async function getRepos(): Promise<Repo[]> {
  try {
    return await api.get<Repo[]>("/repos");
  } catch {
    return [];
  }
}
