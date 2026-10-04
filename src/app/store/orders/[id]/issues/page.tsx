import type { Metadata } from "next";
import { OrderIssues } from "@/features/store/components/issue-view";
export const metadata: Metadata = { title: "Order issues" };
export default async function Page({
  params,
}: PageProps<"/store/orders/[id]/issues">) {
  const { id } = await params;
  return <OrderIssues id={id} />;
}
