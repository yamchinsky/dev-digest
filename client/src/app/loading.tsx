import { Skeleton } from "@devdigest/ui";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";

/** Default route-level loading UI. Individual segments can override with their
    own loading.tsx when they need a tighter shape; this is the safe fallback
    Next.js renders while a server component or data dependency suspends. */
export default function Loading() {
  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <PageContainer>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
          <Skeleton height={20} width={240} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      </PageContainer>
    </AppShell>
  );
}
