import type { Metadata } from "next";
import { Inter } from "next/font/google";
import ScrollProgress from "@/src/components/ScrollProgress";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "AI Recap - AI Intelligence Newsletter",
  description: "Get the latest AI news, research insights, and practical implementation guides delivered to your inbox daily from AI Recap.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Molengo&family=Syne+Mono&family=WDXL+Lubrifont+SC&display=swap" rel="stylesheet" />
      </head>
      <body className={`${inter.variable} antialiased`}>
        <ScrollProgress />
        {children}
      </body>
    </html>
  );
}
