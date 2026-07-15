import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { AuthListener } from "@/components/auth/AuthListener";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Luxury serif for the Dragons brand mark and restaurant names —
// the "Dragons Alliance Premium" reference uses a gold serif identity.
const playfair = Playfair_Display({
  variable: "--font-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Chișinău Delivery",
  description: "Livrare sushi și fine dining în Chișinău.",
  manifest: "/manifest.webmanifest",
};

export const viewport = {
  themeColor: "#0d0d1f",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ro"
      className={`${geistSans.variable} ${geistMono.variable} ${playfair.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthListener />
        {children}
      </body>
    </html>
  );
}
