import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Preloader from "@/components/Preloader";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "SkyVult — Binary Options Trading",
  description: "Trade EUR/USD, BTC, Gold and more. All amounts in Ghana Cedis. 80% payout.",
  manifest: "/manifest.json",
  appleWebApp: { statusBarStyle: "black-translucent", title: "SkyVult" },
  icons: {
    icon:  "/SkyVult logo.png",
    apple: "/SkyVult logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f7a600",
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="min-h-screen bg-bg text-white antialiased" suppressHydrationWarning>
        <Preloader />
        {children}
      </body>
    </html>
  );
}
