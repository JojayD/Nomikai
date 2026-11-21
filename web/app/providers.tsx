"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";

export default function Providers({ children }: { children: React.ReactNode }) {
  // Per-request client — a module-level one would share cache across users on SSR.
  const [client] = useState(
    () =>
      new QueryClient({
        // Feeds and leaderboards change from other people's actions, so refetch
        // on focus/reconnect (defaults), but not on every remount.
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Retrying a rate-limited read only adds to the pile.
            retry: (failures, error) =>
              !(error instanceof ApiError && error.status === 429) &&
              failures < 3,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
