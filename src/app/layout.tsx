import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BTC Binary Trading Agent — Live Prediction Dashboard",
  description: "Real-time BTC/USDT binary trading prediction agent powered by StochRSI and MA-StochRSI indicators.",
  keywords: ["BTC", "Bitcoin", "Trading", "Prediction", "StochRSI", "AI Agent", "Binary Options"],
  authors: [{ name: "BTC Trading Agent" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "BTC Binary Trading Agent",
    description: "Live prediction dashboard with StochRSI + MA-StochRSI indicators",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BTC Binary Trading Agent",
    description: "Live prediction dashboard with StochRSI + MA-StochRSI indicators",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
