import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { THEME_COOKIE } from "@/lib/settings-runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: "PG Insurance",
  description: "Cockpit local para operar una cartera de seguros.",
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
      className={`h-full antialiased ${initialTheme === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-sans">
        <ThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false} disableTransitionOnChange>
          <TooltipProvider delay={160}>
            {children}
            <Toaster richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
        <SpeedInsights />
      </body>
    </html>
  );
}
