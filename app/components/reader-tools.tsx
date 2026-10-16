"use client";
import { useEffect, useState } from "react";
import { ArrowUpRight, Check, Copy, Share2 } from "lucide-react";
import { articleUrl } from "@/lib/article";
export default function ReaderTools({ id, slug, title }: { id?: string; slug: string; title: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!id) return;
    const key = "list:view:" + id + ":" + new Date().toISOString().slice(0,10);
    try {
      if (sessionStorage.getItem(key)) return;
      fetch("/api/views/" + id, { method: "POST" }).then((r) => { if (r.ok) sessionStorage.setItem(key, "1"); }).catch(() => {});
    } catch {}
  }, [id]);
  async function share() {
    const url = articleUrl(slug);
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e instanceof Error && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2500); }
    catch { window.prompt("Скопируйте ссылку", url); }
  }
  return <nav className="reader-nav"><a href="/" className="wordmark"><span className="brand-icon">л</span>лист<span className="wordmark-dot">.</span></a><div className="reader-nav-right"><a href="/">Создать свой лист <ArrowUpRight size={14} /></a><button onClick={share} className="btn btn-light">{copied ? <Check size={16} /> : <Share2 size={16} />}<span>{copied ? "Скопировано" : "Поделиться"}</span></button></div></nav>;
}
