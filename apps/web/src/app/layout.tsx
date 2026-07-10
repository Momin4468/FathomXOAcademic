import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/confirm";

// The marketing site's type pairing — serif display (Fraunces) + sans body (Inter)
// — so the tool reads as one product with xfactoras.com.
const display = Fraunces({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-display" });
const sans = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "X-Factor AS — FathomXO Academic",
  description: "Capture-first work queue & core ledger.",
};

// Mobile-first / PWA-ready from day one (spec §10).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

// Apply the saved theme before paint so there's no light→dark flash on load.
// Default is LIGHT content (no `.dark` class) unless the user chose dark.
const themeScript = `try{if(localStorage.getItem('xfas-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen bg-ink-900 font-sans text-slate-200 antialiased">
        <ToastProvider>
          <ConfirmProvider>{children}</ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
