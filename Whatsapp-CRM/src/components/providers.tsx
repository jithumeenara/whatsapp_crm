"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { IdleTimeoutWarning } from "@/components/idle-timeout-warning";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      {children}
      {/* No-op while signed out (useSession() status !== 'authenticated');
       *  see src/hooks/use-idle-timeout.ts + src/proxy.ts for the full
       *  client+server idle-logout design. */}
      <IdleTimeoutWarning />
    </SessionProvider>
  );
}
