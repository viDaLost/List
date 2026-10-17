import type { Metadata, Viewport } from "next";
import { SITE_ORIGIN } from "@/lib/article";
import "./globals.css";
import "./enhancements.css";
import "./public.css";
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "Letro — публикации с характером",
  applicationName: "Letro",
  appleWebApp: { title: "Letro" },
  description: "Простой редактор историй. Свой адрес, своё оформление и красивая карточка ссылки.",
  metadataBase: new URL(SITE_ORIGIN),
  icons: {
    icon: "/favicon.svg?v=letro",
    shortcut: "/favicon.svg?v=letro",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
