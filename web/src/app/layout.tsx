import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import localFont from "next/font/local";
import { Providers } from "@/components/providers";
import "./globals.css";

const jakarta = localFont({
  variable: "--font-jakarta",
  display: "swap",
  src: [
    { path: "../fonts/pj-400.ttf", weight: "400", style: "normal" },
    { path: "../fonts/pj-500.ttf", weight: "500", style: "normal" },
    { path: "../fonts/pj-600.ttf", weight: "600", style: "normal" },
    { path: "../fonts/pj-700.ttf", weight: "700", style: "normal" },
    { path: "../fonts/pj-800.ttf", weight: "800", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: { default: "Agent — Your money, on chat.", template: "%s · Agent" },
  description:
    "A smart wallet you chat with. It compares rates across Stellar, shows a preview, and only moves money when you say yes. Working name; not live.",
};

export const viewport: Viewport = {
  themeColor: "#08318D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${jakarta.variable} h-full antialiased`}>
      <body className="min-h-full">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
