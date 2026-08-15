import type { Metadata } from "next";
import { Geist, Geist_Mono, Playfair_Display } from "next/font/google";
import { AuthListener } from "@/components/auth/AuthListener";
import { ServiceWorkerRegister } from "@/components/shared/ServiceWorkerRegister";
import { SITE_NAME, SITE_TAGLINE, siteUrl } from "@/lib/seo/site";
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

// Audit de creștere 2026-08-15: fiecare pagină moștenea același titlu generic.
// `template` lasă paginile să-și spună numele (restaurantul, catering-ul) și
// păstrează brandul în coadă; metadataBase face ca imaginile de partajare să
// aibă adrese absolute, altfel previzualizarea pe WhatsApp/Facebook e goală.
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: `${SITE_NAME} — ${SITE_TAGLINE}`,
    template: `%s · ${SITE_NAME}`,
  },
  description:
    "Comandă sushi, fine dining și catering în Chișinău: meniuri cu fotografii reale, urmărire live a livrării, plată cash sau card la ușă.",
  applicationName: SITE_NAME,
  manifest: "/manifest.webmanifest",
  openGraph: {
    type: "website",
    locale: "ro_MD",
    siteName: SITE_NAME,
    title: `${SITE_NAME} — ${SITE_TAGLINE}`,
    description: "Sushi, fine dining și catering livrate în Chișinău, cu urmărire live.",
    url: siteUrl(),
  },
  robots: { index: true, follow: true },
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
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
