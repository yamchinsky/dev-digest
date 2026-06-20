import type { Metadata } from "next";

/** Dynamic title from the URL param so browser tabs read "PR #123 · DevDigest"
    instead of the global default. No fetch needed — the number is in the path. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  return { title: `PR #${number} · DevDigest` };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
