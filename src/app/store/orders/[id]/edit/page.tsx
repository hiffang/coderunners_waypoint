import type { Metadata } from "next";
import { EditOrder } from "@/features/store/components/order-form";
export const metadata: Metadata = { title: "Edit order" };
export default async function Page({
  params,
}: PageProps<"/store/orders/[id]/edit">) {
  const { id } = await params;
  return <EditOrder id={id} />;
}
