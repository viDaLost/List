import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { publishedArticle,sql } from "@/lib/server";
import { normalizeSlug, articleText, articleUrl, SITE_ORIGIN } from "@/lib/article";
import ReaderExperience from "@/app/components/reader-experience";
import { getAuthorUser, authorAccessPath } from "@/app/author-access";
export const dynamic = "force-dynamic";
type Props = { params: Promise<{ slug: string[] }> };
async function getArticle(params: Props["params"]) {
  const { slug } = await params;
  let path: string;
  try { path = normalizeSlug(slug.join("/")); } catch { return null; }
  return publishedArticle(path);
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const article = await getArticle(params);
  if (!article) return { title: "Статья не найдена" };
  const title = article.shareTitle || article.title;
  const description = article.shareDescription || article.subtitle || articleText(article).slice(0, 180);
  const image = article.shareImage || article.cover;
  const absoluteImage = image ? new URL(image, SITE_ORIGIN).href : undefined;
  const url = articleUrl(article.slug);
  return { title, description, alternates: { canonical: url }, openGraph: { title, description, url, type: "article", siteName: "Letro", locale: "ru_RU", ...(absoluteImage ? { images: [{ url: absoluteImage }] } : {}) }, twitter: { card: absoluteImage ? "summary_large_image" : "summary", title, description, ...(absoluteImage ? { images: [absoluteImage] } : {}) } };
}
export default async function PublishedPage({ params }: Props) {
  const article = await getArticle(params);
  if (!article) notFound();
  const { slug } = await params;
  if (slug.join("/") !== article.slug) redirect("/" + article.slug.split("/").map(encodeURIComponent).join("/"));
  const user = await getAuthorUser();
  const canEdit=!!user&&!!await sql().prepare('SELECT id FROM articles WHERE id=? AND owner_id=?').bind(article.id,user!.userId).first();
  return <ReaderExperience article={article} canReport={!!user} canEdit={canEdit} editHref={'/?article='+article.id} reportSignIn={authorAccessPath("/" + article.slug)} />;
}
