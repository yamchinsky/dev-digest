import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Agents · DevDigest",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
