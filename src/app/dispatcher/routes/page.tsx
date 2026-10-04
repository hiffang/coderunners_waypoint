import { DispatcherPortal } from "@/features/dispatcher/components/portal";
import { localDate } from "@/server/time";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ serviceDate?: string }>;
}) {
  const { serviceDate } = await searchParams;
  return (
    <DispatcherPortal
      view="routes"
      initialDate={
        serviceDate && /^\d{4}-\d{2}-\d{2}$/.test(serviceDate)
          ? serviceDate
          : localDate()
      }
    />
  );
}
