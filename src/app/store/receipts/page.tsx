import type { Metadata } from "next";
import { OrderList } from "@/features/store/components/order-list";
export const metadata: Metadata = { title: "Receipts" };
export default function Page() {
  return <OrderList mode="receipts" />;
}
