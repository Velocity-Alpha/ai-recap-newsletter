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
      <body className={`${inter.variable} antialiased`}>
        <ScrollProgress />
        {children}
      </body>
    </html>
  );
}
