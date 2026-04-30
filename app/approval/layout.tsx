import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Story Approval | AI Recap",
  description: "Review and approve the AI Recap story outline before generation.",
};

export default function ApprovalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
