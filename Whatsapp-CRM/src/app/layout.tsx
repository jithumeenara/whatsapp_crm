import type { Metadata, Viewport } from "next";
import { Inter, Anek_Malayalam } from "next/font/google";
import { cookies } from "next/headers";
import { Toaster } from "sonner";
import "./globals.css";
// Real flag SVGs (fi-xx classes, keyed by lowercase ISO code) — the
// CountryCodeSelect's flags used to be plain emoji, which Windows mostly
// renders as a bare two-letter fallback (no visible flag at all, exactly
// what was reported). This package ships real graphics instead.
import "flag-icons/css/flag-icons.min.css";
import { ThemeProvider } from "@/hooks/use-theme";
import { Providers } from "@/components/providers";
import { auth } from "@/auth";
import { DEFAULT_THEME, STORAGE_KEY, THEME_IDS } from "@/lib/themes";
import type { ThemeId } from "@/lib/themes";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Malayalam text (chat messages, contact names, etc.) previously fell back
// to whatever generic system font the browser had for that script — Inter
// has no Malayalam glyphs at all. Anek Malayalam's font file is subsetted
// to the Malayalam Unicode block, so stacking it after Inter in --font-sans
// (see globals.css) activates automatically only for Malayalam characters,
// never overriding Inter for Latin text.
const anekMalayalam = Anek_Malayalam({
  variable: "--font-malayalam",
  subsets: ["malayalam"],
});

export const metadata: Metadata = {
  title: {
    default: "Lead Magnet CRM",
    template: "%s — Lead Magnet CRM",
  },
  description: "Lead Magnet CRM — WhatsApp, Instagram, Telegram and website chats, leads and AI in one place.",
  robots: {
    index: false,
    follow: false,
  },
  // The Lead Magnet mark (public/brand holds the full kit).
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }, { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
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
  const [theme, session] = await Promise.all([getThemeCookie(), auth().catch(() => null)]);
  // A development machine says so on every page (src/lib/dev/send-guard.ts).
  const isDevMachine = ["development", "dev", "local"].includes((process.env.APP_ENV ?? "").trim().toLowerCase());

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${inter.variable} ${anekMalayalam.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-white text-slate-900 font-sans">
        {isDevMachine && (
          <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[9999] flex justify-center">
            <div className="absolute inset-x-0 top-0 h-[3px] bg-red-600" />
            {/* On a phone the centred label sat on the page title; it goes to a bottom corner there. */}
            <span className="fixed bottom-1 left-1 rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold tracking-widest text-white shadow sm:static sm:mt-[3px] sm:rounded-t-none sm:rounded-b-md">DEV · nothing is sent</span>
          </div>
        )}
        <Providers session={session}>
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
