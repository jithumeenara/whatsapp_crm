"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import type { Session } from "next-auth";
import { IdleTimeoutWarning } from "@/components/idle-timeout-warning";

// The server already knows who is signed in: handing that over means the
// screen never waits on a session fetch behind a full-page spinner.
export function Providers({ children, session }: { children: ReactNode; session?: Session | null }) {
  return (
    <SessionProvider session={session}>
      {children}
      {/* No-op while signed out (useSession() status !== 'authenticated');
       *  see src/hooks/use-idle-timeout.ts + src/proxy.ts for the full
       *  client+server idle-logout design. */}
      <IdleTimeoutWarning />
    </SessionProvider>
  );
}
