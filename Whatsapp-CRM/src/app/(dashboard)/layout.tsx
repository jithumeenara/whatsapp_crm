import type { Metadata } from "next";
import { DashboardShellV2 } from "@/components/layout-v2/dashboard-shell-v2";

export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function V2DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardShellV2>{children}</DashboardShellV2>;
}
