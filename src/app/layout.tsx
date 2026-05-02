import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

export const metadata: Metadata = {
  title: "PG Insurance",
  description: "Cockpit local para operar una cartera de seguros.",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        <TooltipProvider delay={160}>
          {children}
          <Toaster richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
