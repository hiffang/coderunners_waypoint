"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { Toaster } from "@/components/ui/sonner";
import { ApiClientError } from "@/shared/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: true,
            retry: (count, err) =>
              !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <SessionProvider>
      <QueryClientProvider client={client}>
        {children}
        <Toaster position="top-center" richColors />
      </QueryClientProvider>
    </SessionProvider>
  );
}
