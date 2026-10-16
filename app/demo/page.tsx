import type { Metadata } from "next";
import ReaderExperience from "@/app/components/reader-experience";
import { demoArticle, SITE_ORIGIN } from "@/lib/article";
export const metadata: Metadata = { title: "Пример статьи — Лист", description: "Оглавление, краткая версия, чек-листы и личные заметки в одной статье.", alternates: { canonical: SITE_ORIGIN + "/demo" }, openGraph: { title: "Искусство замечать — пример статьи в Листе", description: "Попробуйте краткую версию, отмечаемый чек-лист и заметки читателя.", type: "article", url: SITE_ORIGIN + "/demo", images: [{ url: SITE_ORIGIN + "/covers/stillness.png" }] } };
export default function DemoPage() {
  return <ReaderExperience article={{ ...demoArticle("Лист · пример статьи"), slug: "demo" }} />;
}
