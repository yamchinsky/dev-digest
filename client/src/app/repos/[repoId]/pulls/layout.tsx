import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pull requests · DevDigest",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
