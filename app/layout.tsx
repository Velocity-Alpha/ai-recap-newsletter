import type { Metadata } from "next";
import { Libre_Baskerville, Source_Sans_3 } from "next/font/google";
import Script from "next/script";
import ScrollProgress from "@/src/components/ScrollProgress";
import "./globals.css";

const libreBaskerville = Libre_Baskerville({
  weight: ['400', '700'],
  style: ['normal', 'italic'],
  subsets: ["latin"],
  variable: "--font-serif",
});

const sourceSans = Source_Sans_3({
  weight: ['400', '500', '600', '700', '800', '900'],
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://airecap.news"),
  title: "AI Recap - AI Intelligence Newsletter",
  description: "Get the latest AI news, research insights, and practical implementation guides delivered to your inbox daily from AI Recap.",
  icons: {
    icon: [
      { url: "/favicons/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicons/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/favicons/apple-touch-icon.png",
    shortcut: "/favicons/favicon.ico",
  },
  manifest: "/favicons/site.webmanifest",
  openGraph: {
    type: "website",
    siteName: "AI Recap",
    title: "AI Recap - AI Intelligence Newsletter",
    description: "Get the latest AI news, research insights, and practical implementation guides delivered to your inbox daily from AI Recap.",
    images: [{ url: "/logo/OG-Logo.jpg", width: 1200, alt: "AI Recap" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AI Recap - AI Intelligence Newsletter",
    description: "Get the latest AI news, research insights, and practical implementation guides delivered to your inbox daily from AI Recap.",
    images: ["/logo/OG-Logo.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-1ZK1RC1RE1"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-1ZK1RC1RE1');
          `}
        </Script>
      </head>
      <body
        suppressHydrationWarning
        className={`${libreBaskerville.variable} ${sourceSans.variable} antialiased`}
      >
        <ScrollProgress />
        {children}
      </body>
    </html>
  );
}
