import Link from "next/link";
// Deep-import: same reason as loading.tsx — keep charts/Recharts out of the RSC graph.
import { EmptyState } from "@devdigest/ui/primitives";
import { AppShell } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";

/** Default 404 page. Rendered when a route is unmatched or `notFound()` is called. */
export default function NotFound() {
  return (
    <AppShell crumb={[{ label: "DevDigest" }]}>
      <PageContainer>
        <EmptyState
          icon="Search"
          title="Page not found"
          body={
            <span>
              The page you’re looking for doesn’t exist.{" "}
              <Link href="/" style={{ color: "var(--accent)" }}>
                Back to home
              </Link>
            </span>
          }
        />
      </PageContainer>
    </AppShell>
  );
}
