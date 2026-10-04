import type { Metadata } from "next";
import { ReceiptView } from "@/features/store/components/receipt-view";
export const metadata: Metadata = { title: "Receipt" };
export default async function Page({
  params,
}: PageProps<"/store/orders/[id]/receipt">) {
  const { id } = await params;
  return <ReceiptView id={id} />;
}
