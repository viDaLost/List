"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bookmark, Check, Download, Flag, List, Loader2, Maximize2, MessageSquare, Minimize2, Plus, Printer, Settings2, Share2, Trash2, X, Zap } from "lucide-react";
import { type Article, articleOutline, articleUrl, suggestSlug } from "@/lib/article";
import { type ReaderNote, notesMarkdown, parseNotes, parseProgress } from "@/lib/reading";
import { ArticleView, articleStyle } from "./article-view";

export default function ReaderExperience({ article, canReport = false, reportSignIn = "/" }: { article: Article; canReport?: boolean; reportSignIn?: string }) {
  const [drawer, setDrawer] = useState<"notes" | "contents" | "settings" | "report" | null>(null);
  const [reportReason, setReportReason] = useState("spam"), [reportDetails, setReportDetails] = useState(""), [reportBusy, setReportBusy] = useState(false), [reportSent, setReportSent] = useState(false);
  const [summaryOnly, setSummaryOnly] = useState(false), [focusMode, setFocusMode] = useState(false);
  const [scale, setScale] = useState(1), [progress, setProgress] = useState(0);
  const [resume, setResume] = useState<ReturnType<typeof parseProgress>>(null);
  const [notes, setNotes] = useState<ReaderNote[]>([]), [noteText, setNoteText] = useState(""), [noteQuote, setNoteQuote] = useState("");
  const [noteSection, setNoteSection] = useState(""), [message, setMessage] = useState("");
  const drawerRef = useRef<HTMLElement>(null), noteInput = useRef<HTMLTextAreaElement>(null);
  const articleKey = article.id || article.slug, notesKey = "list:notes:" + articleKey, progressKey = "list:progress:" + articleKey;
  const outline = articleOutline(article), hasSummary = article.blocks.some((b) => b.type === "summary" && b.text.trim());
  const renderedArticle = useMemo(() => <ArticleView article={article} summaryOnly={summaryOnly} />, [article, summaryOnly]);
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    const before = () => { opened = Array.from(document.querySelectorAll<HTMLDetailsElement>(".article-details:not([open])")); for (const el of opened) el.open = true; };
    const after = () => { for (const el of opened) el.open = false; opened = []; };
    window.addEventListener("beforeprint", before); window.addEventListener("afterprint", after);
    return () => { window.removeEventListener("beforeprint", before); window.removeEventListener("afterprint", after); after(); };
  }, []);
  useEffect(() => {
    try {
      setNotes(parseNotes(localStorage.getItem(notesKey)));
      const previous = parseProgress(localStorage.getItem(progressKey));
      if (!window.location.hash && previous && previous.fraction > .03 && previous.fraction < .98) setResume(previous);
      const size = Number(localStorage.getItem("list:reading-size"));
      if (Number.isFinite(size) && size >= .9 && size <= 1.3) setScale(size);
    } catch {}
    if (!article.id) return;
    const key = "list:view:" + article.id + ":" + new Date().toISOString().slice(0,10);
    try {
      if (sessionStorage.getItem(key)) return;
      fetch("/api/views/" + article.id, { method: "POST" }).then((r) => { if (r.ok) sessionStorage.setItem(key, "1"); }).catch(() => {});
    } catch {}
  }, [article.id, notesKey, progressKey]);
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(timer);
  }, [message]);
  useEffect(() => {
    let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
    function savePosition() {
      if (summaryOnly || window.scrollY < 20) return;
      const length = document.documentElement.scrollHeight - window.innerHeight;
      let section = "";
      const blocks = document.querySelectorAll<HTMLElement>(".reader-block");
      for (const el of blocks) { if (el.getBoundingClientRect().top <= 180) section = el.id; else break; }
      try { localStorage.setItem(progressKey, JSON.stringify({ fraction: length > 0 ? window.scrollY / length : 1, section })); } catch {}
    }
    function update() {
      frame = 0;
      const length = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(length > 0 ? Math.min(100, Math.max(0, Math.round(window.scrollY / length * 100))) : 0);
      if (timer) clearTimeout(timer);
      timer = setTimeout(savePosition, 750);
    }
    function onScroll() { if (!frame) frame = requestAnimationFrame(update); }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("pagehide", savePosition);
    update();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); window.removeEventListener("pagehide", savePosition); cancelAnimationFrame(frame); if (timer) clearTimeout(timer); };
  }, [progressKey, summaryOnly]);
  useEffect(() => {
    if (!drawer) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; drawerRef.current?.focus();
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") setDrawer(null);
      if (event.key === "Tab") {
        const elements = drawerRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, textarea");
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawerRef.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", key); previousFocus?.focus(); };
  }, [drawer]);
  function jump(section: string, fraction?: number) {
    setSummaryOnly(false); setDrawer(null); setResume(null);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = section ? document.getElementById(section) : null;
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      else if (typeof fraction === "number") window.scrollTo({ top: fraction * (document.documentElement.scrollHeight - window.innerHeight), behavior: "smooth" });
      if (el) { const url = new URL(window.location.href); url.hash = section; window.history.replaceState(null, "", url); }
    }));
  }
  async function share() {
    const url = articleUrl(article.slug);
    if (navigator.share) {
      try { await navigator.share({ title: article.title, url }); return; } catch (e) { if (e instanceof Error && e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); setMessage("Ссылка скопирована."); }
    catch { window.prompt("Скопируйте ссылку", url); }
  }
  function openNotes() {
    const selection = window.getSelection(), quote = selection?.toString().trim().slice(0,1200) || "";
    if (quote) {
      setNoteQuote(quote);
      const anchor = selection?.anchorNode;
      const element = anchor instanceof Element ? anchor : anchor?.parentElement;
      setNoteSection(element?.closest<HTMLElement>("[data-block-id]")?.id || "");
    }
    setDrawer("notes");
  }
  function persistNotes(next: ReaderNote[]) {
    setNotes(next);
    try { localStorage.setItem(notesKey, JSON.stringify(next)); return true; }
    catch { setMessage("Браузер не разрешил сохранить заметки. Их можно скачать файлом."); return false; }
  }
  function addNote() {
    if (!noteText.trim() && !noteQuote.trim()) return;
    if (notes.length >= 50) { setMessage("Можно сохранить до 50 заметок к одной статье."); return; }
    const next = [...notes, { id: crypto.randomUUID(), text: noteText.trim(), quote: noteQuote.trim(), section: noteSection, createdAt: Date.now() }];
    const stored = persistNotes(next);
    setNoteText(""); setNoteQuote(""); setNoteSection("");
    if (stored) setMessage("Заметка сохранена на этом устройстве.");
  }
  function exportNotes() {
    const blob = new Blob([notesMarkdown(article.title, articleUrl(article.slug), notes)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = suggestSlug(article.title) + "-notes.md"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function changeScale(value: number) {
    setScale(value);
    try { localStorage.setItem("list:reading-size", String(value)); } catch {}
  }
  async function reportArticle() {
    if (reportBusy || !article.id) return;
    setReportBusy(true);
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ articleId: article.id, reason: reportReason, details: reportDetails, website: "" }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось отправить жалобу.");
      setReportSent(true); setMessage("Жалоба передана владельцу сервиса.");
    } catch (e) { setMessage((e as Error).message); }
    finally { setReportBusy(false); }
  }
  return <main className={"reader-page enhanced-reader " + (focusMode ? "focus-mode " : "") + (summaryOnly ? "summary-mode" : "")} style={{ ...articleStyle(article), "--reading-scale": scale } as React.CSSProperties}>
    <div className="reading-progress" role="progressbar" aria-label="Прочитано" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: progress + "%" }} /></div>
    <nav className="reader-nav"><a href="/" className="wordmark"><span className="brand-icon">л</span>лист<span className="wordmark-dot">.</span></a><span className="reader-article-name">{article.title}</span><div className="reader-nav-right"><button className="btn btn-light" onClick={share}><Share2 size={16} /><span>Поделиться</span></button></div></nav>
    <div className="reading-toolbar" aria-label="Инструменты читателя">
      <div className="reading-toolbar-main">{outline.length > 0 && <button onClick={() => setDrawer("contents")}><List size={17} /><span>Оглавление</span></button>}{hasSummary && <button className={summaryOnly ? "active" : ""} aria-pressed={summaryOnly} onClick={() => { setSummaryOnly(!summaryOnly); setResume(null); window.scrollTo({ top: 0, behavior: "smooth" }); }}><Zap size={16} /><span>{summaryOnly ? "Полный текст" : "Суть за минуту"}</span></button>}<button onMouseDown={(e) => e.preventDefault()} onClick={openNotes}><MessageSquare size={16} /><span>Мои заметки{notes.length > 0 ? " · " + notes.length : ""}</span></button></div>
      <div className="reading-toolbar-extra"><button onClick={() => setDrawer("settings")} aria-label="Настроить чтение"><Settings2 size={17} /></button><button aria-pressed={focusMode} title={focusMode ? "Вернуть навигацию" : "Читать без отвлечений"} aria-label={focusMode ? "Вернуть навигацию" : "Читать без отвлечений"} onClick={() => setFocusMode(!focusMode)}>{focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button><span className="reading-percent">{progress}%</span></div>
    </div>
    {resume && !summaryOnly && <div className="resume-banner"><Bookmark size={18} /><div><strong>Продолжить с того же места?</strong><span>В прошлый раз вы прочитали {Math.round(resume.fraction * 100)}%</span></div><button onClick={() => jump(resume.section, resume.fraction)}>Продолжить <ArrowRight size={15} /></button><button className="icon-button" aria-label="Не продолжать" onClick={() => setResume(null)}><X size={17} /></button></div>}
    {summaryOnly && <div className="summary-mode-notice"><Zap size={15} />Краткая версия, подготовленная автором</div>}
    {renderedArticle}
    {summaryOnly && <div className="full-article-action"><button className="btn btn-primary" onClick={() => setSummaryOnly(false)}>Прочитать всю историю <ArrowRight size={16} /></button></div>}
    <div className="reader-footer">Сделано в <a href="/">Листе</a> — место для ваших историй.<div className="reader-footer-links"><a href="/_list/about">Как устроен сервис</a>{article.id && <button onClick={() => setDrawer("report")}><Flag size={13} />Пожаловаться на статью</button>}</div></div>
    {drawer && <><button className="reader-drawer-backdrop" aria-label="Закрыть панель" onClick={() => setDrawer(null)} /><aside className="reader-drawer" role="dialog" aria-modal="true" aria-label={drawer === "notes" ? "Мои заметки" : drawer === "contents" ? "Оглавление" : "Настройки чтения"} ref={drawerRef} tabIndex={-1}>
      <div className="reader-drawer-heading"><div><span className="eyebrow">ВАША СТАТЬЯ. ВАШ ТЕМП.</span><h2>{drawer === "notes" ? "Оставьте себе мысль" : drawer === "contents" ? "Карта статьи" : drawer === "report" ? "Сообщить о проблеме" : "Читайте как удобно"}</h2></div><button className="icon-button" onClick={() => setDrawer(null)} aria-label="Закрыть панель"><X size={21} /></button></div>
      <div className="reader-drawer-body">
        {drawer === "report" && <>{reportSent ? <div className="report-thanks"><Check size={34} /><h3>Спасибо, мы получили жалобу</h3><p>Владелец сервиса рассмотрит её. Статья не скрывается автоматически.</p></div> : !canReport ? <><p className="reader-panel-intro">Чтобы отправить жалобу, откройте редактор и создайте ключ браузера — регистрация не нужна. Затем вернитесь к статье.</p><a href={reportSignIn} target="_top" className="btn btn-primary full">Открыть редактор <ArrowUpRight size={15} /></a></> : <><p className="reader-panel-intro">Жалоба на статью «{article.title}». Автор не увидит ваш аккаунт или текст обращения.</p><label className="field-label">Причина<select className="field report-select" value={reportReason} onChange={(e) => setReportReason(e.target.value)}><option value="spam">Спам или обман</option><option value="harmful">Опасный или оскорбительный контент</option><option value="rights">Нарушение авторских прав</option><option value="other">Другое</option></select></label><label className="field-label">Что произошло?<textarea className="field field-textarea note-input" maxLength={1500} value={reportDetails} placeholder="Добавьте подробности, чтобы нам было проще разобраться" onChange={(e) => setReportDetails(e.target.value)} /></label><button className="btn btn-primary full" disabled={reportBusy} onClick={() => void reportArticle()}>{reportBusy ? <Loader2 className="spin" size={16} /> : <Flag size={16} />}Отправить жалобу</button><p className="notes-local-hint">Обращение будет доступно только владельцу сервиса. Не указывайте пароли или платёжные данные.</p></>}</>}
        {drawer === "contents" && <><p className="reader-panel-intro">Переходите прямо к нужному разделу. Значок ссылки возле заголовка позволяет поделиться именно этим местом.</p><nav className="reader-outline" aria-label="Разделы статьи">{outline.map((item, i) => <button key={item.id} onClick={() => jump(item.id)}><span>{String(i + 1).padStart(2,"0")}</span><strong>{item.title}</strong><ArrowUpRight size={16} /></button>)}</nav></>}
        {drawer === "notes" && <>
          <p className="reader-panel-intro">Выделите фрагмент статьи и нажмите «Мои заметки», чтобы сохранить цитату вместе с комментарием.</p>
          {noteQuote && <div className="note-quote-draft"><blockquote>{noteQuote}</blockquote><button className="icon-button" aria-label="Убрать цитату" onClick={() => { setNoteQuote(""); setNoteSection(""); }}><X size={16} /></button></div>}
          <label className="field-label">Новая заметка<textarea ref={noteInput} className="field field-textarea note-input" value={noteText} maxLength={2000} placeholder="Что хочется запомнить или попробовать?" onChange={(e) => setNoteText(e.target.value)} /></label>
          <button className="btn btn-primary full" onClick={addNote} disabled={!noteText.trim() && !noteQuote.trim()}><Plus size={16} />Сохранить мысль</button>
          <p className="notes-local-hint">Заметки видны только вам в этом браузере. Они не отправляются автору и не синхронизируются между устройствами.</p>
          <div className="saved-notes-heading"><h3>Сохранено · {notes.length}</h3><button className="icon-button" disabled={!notes.length} title="Скачать заметки" aria-label="Скачать заметки" onClick={exportNotes}><Download size={17} /></button></div>
          {!notes.length && <div className="empty-notes"><MessageSquare size={26} /><p>Самые важные мысли останутся здесь.</p></div>}
          {[...notes].reverse().map((note) => <div className="reader-note" key={note.id}>{note.quote && <blockquote>{note.quote}</blockquote>}{note.text && <p>{note.text}</p>}<div className="reader-note-footer">{note.section ? <button onClick={() => jump(note.section)}>К фрагменту <ArrowUpRight size={13} /></button> : <span>{new Date(note.createdAt).toLocaleDateString("ru")}</span>}<button className="icon-button" aria-label="Удалить заметку" onClick={() => persistNotes(notes.filter((n) => n.id !== note.id))}><Trash2 size={15} /></button></div></div>)}
        </>}
        {drawer === "settings" && <><p className="reader-panel-intro">Размер текста меняется только для вас. Оформление автора сохраняется.</p><div className="reading-size-label"><span>Размер текста</span><strong>{Math.round(scale * 100)}%</strong></div><input className="reading-size-slider" type="range" min="90" max="130" step="5" value={Math.round(scale * 100)} aria-label="Размер текста в процентах" onChange={(e) => changeScale(Number(e.target.value) / 100)} /><p className="reading-size-example" style={{ fontSize: 18 * scale }}>Хорошая история заслуживает удобного чтения.</p><button className="btn btn-light full" onClick={() => { setFocusMode(!focusMode); setDrawer(null); }}>{focusMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}{focusMode ? "Вернуть навигацию" : "Читать без отвлечений"}</button><button className="btn btn-light full print-button" onClick={() => { setDrawer(null); setTimeout(() => window.print(), 150); }}><Printer size={16} />Печать или сохранение в PDF</button></>}
      </div>
    </aside></>}
    {message && <div className="toast reader-toast" role="status"><span>{message}</span><button aria-label="Скрыть сообщение" onClick={() => setMessage("")}><X size={16} /></button></div>}
  </main>;
}
