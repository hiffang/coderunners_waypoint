import type { Metadata } from "next";
import { IssuesPage } from "@/features/store/components/issue-view";
export const metadata: Metadata = { title: "Issues" };
export default function Page() {
  return <IssuesPage />;
}
