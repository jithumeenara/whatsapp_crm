import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { Providers } from "@/components/providers";
import { DEFAULT_THEME, STORAGE_KEY, THEME_IDS } from "@/lib/themes";
import type { ThemeId } from "@/lib/themes";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "WhatsApp CRM Pro",
    template: "%s — WhatsApp CRM Pro",
  },
  description: "Self-hosted WhatsApp CRM for teams.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: [{ url: "/icon" }],
  },
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#25D366",
  colorScheme: "light",
};

async function getThemeCookie(): Promise<ThemeId> {
  const jar = await cookies();
  const val = jar.get(STORAGE_KEY)?.value;
  return (THEME_IDS as readonly string[]).includes(val ?? "") ? (val as ThemeId) : DEFAULT_THEME;
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = await getThemeCookie();

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-slate-900 font-sans">
        <Providers>
        <ThemeProvider>
          {children}
          <Toaster
            theme="light"
            position="top-right"
            toastOptions={{
              style: {
                background: "white",
                border: "1px solid #e5e7eb",
                color: "#111827",
              },
            }}
          />
        </ThemeProvider>
        </Providers>
      </body>
    </html>
  );
}
