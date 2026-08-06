import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_COOKIE } from "@/lib/settings-runtime";
import "./globals.css";

// Next bundles the Geist webfonts used by its devtools. Referencing those
// local assets keeps production builds deterministic and avoids a build-time
// dependency on fonts.googleapis.com.
const geistSans = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-latin.woff2",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "../../node_modules/next/dist/next-devtools/server/font/geist-mono-latin.woff2",
  variable: "--font-geist-mono",
  display: "swap",
});

// Variable Source Serif 4 (latin subset, weights 400–700) ships with the repo
// so builds stay deterministic without a fonts.googleapis.com dependency.
const sourceSerif = localFont({
  src: "./fonts/source-serif-4-latin.woff2",
  variable: "--font-source-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "PolicyDesk",
  description: "Centro operativo para una cartera de seguros.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const themeCookie = cookieStore.get(THEME_COOKIE)?.value;
  const initialTheme = themeCookie === "dark" || themeCookie === "light" ? themeCookie : "light";
  return (
    <html
      lang="es"
      className={`h-full antialiased ${geistSans.variable} ${geistMono.variable} ${sourceSerif.variable} ${initialTheme === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false} disableTransitionOnChange>
          <TooltipProvider delay={160}>
            {children}
            <Toaster richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
