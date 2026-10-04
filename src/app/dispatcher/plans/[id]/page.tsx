import { Planner } from "@/features/dispatcher/components/planner";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <Planner id={(await params).id} />;
}
