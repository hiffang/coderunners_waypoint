import type { Metadata } from "next";
import { IssuesView } from "@/features/loader/components/issues-view";

export const metadata: Metadata = { title: "Loading issues" };

export default function LoaderIssuesPage() {
  return <IssuesView />;
}
