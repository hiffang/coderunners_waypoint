import { LoaderCircle } from "lucide-react";
import { Logo } from "@/components/shell/logo";
import { cn } from "@/lib/utils";

type Portal = "dispatcher" | "loader" | "driver" | "store";

const portalLabels: Record<Portal, string> = {
  dispatcher: "Dispatch workspace",
  loader: "Loading workspace",
  driver: "Driver workspace",
  store: "Store workspace",
};

/** Shared by streamed routes and client data loads; never delays ready content. */
export function LoadingScreen({
  portal,
  title = "Getting things ready",
  description = "Your workspace will be ready shortly.",
  fullScreen = false,
}: {
  portal?: Portal;
  title?: string;
  description?: string;
  fullScreen?: boolean;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "flex w-full items-center justify-center px-4 py-10 text-foreground",
        fullScreen ? "min-h-svh bg-background" : "min-h-[min(60svh,32rem)]",
      )}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border bg-card text-center shadow-sm">
        <div aria-hidden="true" className="h-1 bg-lime" />
        <div className="flex flex-col items-center px-6 py-9 sm:px-9">
          <div aria-hidden="true"><Logo /></div>
          <p className="mt-4 text-xs font-medium tracking-wide text-muted-foreground">
            {portal ? portalLabels[portal] : "Distribution, connected"}
          </p>
          <div aria-hidden="true" className="my-7 flex size-14 items-center justify-center rounded-2xl border bg-secondary">
            <LoaderCircle className="size-6 text-foreground motion-safe:animate-spin" strokeWidth={1.5} />
          </div>
          <p className="text-lg font-semibold tracking-tight">{title}</p>
          <p className="mt-2 max-w-64 text-sm leading-6 text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  );
}
