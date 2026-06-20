import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Onboarding · DevDigest",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
