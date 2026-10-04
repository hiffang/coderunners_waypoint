import type { Metadata } from "next";
import { NewOrder } from "@/features/store/components/order-form";
export const metadata: Metadata = { title: "New order" };
export default function Page() {
  return <NewOrder />;
}
