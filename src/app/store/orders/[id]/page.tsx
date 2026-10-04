import type { Metadata } from "next";
import { OrderDetail } from "@/features/store/components/order-detail";
export const metadata: Metadata = { title: "Order details" };
export default async function Page({
  params,
}: PageProps<"/store/orders/[id]">) {
  const { id } = await params;
  return <OrderDetail id={id} />;
}
