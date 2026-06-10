import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Preloader from "@/components/Preloader";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://skyvult.com"),
  title: {
    default: "SkyVult — Forex Trading Game",
    template: "%s | SkyVult",
  },
  description: "A forex trading game. Predict UP or DOWN on SVX Prime, SVX Titan and more — win up to 80% per round. Play from ₵10 in Ghana Cedis.",
  keywords: ["binary options", "trading", "Ghana", "GHS", "cedis", "BTC", "gold", "forex", "mobile money"],
  authors: [{ name: "SkyVult" }],
  creator: "SkyVult",
  publisher: "SkyVult",
  manifest: "/manifest.json",
  appleWebApp: { statusBarStyle: "black-translucent", title: "SkyVult", capable: true },
  icons: {
    icon:  [
      { url: "/SkyVult logo.png", type: "image/png" },
    ],
    apple: "/SkyVult logo.png",
  },
  openGraph: {
    type: "website",
    url: "https://skyvult.com",
    siteName: "SkyVult",
    title: "SkyVult — Binary Options Trading",
    description: "Trade SVX Prime, SVX Titan and more with 80% payout. Start from ₵10. All amounts in Ghana Cedis.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "SkyVult — Binary Options Trading Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SkyVult — Binary Options Trading",
    description: "Trade SVX Prime, SVX Titan and more with 80% payout. Start from ₵10.",
    images: ["/og-image.png"],
  },
  alternates: {
    canonical: "https://skyvult.com",
  },
  verification: {
    google: "google25075ccc8af78d76",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true },
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
