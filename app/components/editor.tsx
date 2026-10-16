"use client";
import { useEffect, useLayoutEffect, useRef, useState, type TextareaHTMLAttributes } from "react";
import { AlignCenter, AlignLeft, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Bold, BookOpen, Check, CheckCircle2, ChevronDown, CircleHelp, Cloud, Copy, Download, Ellipsis, ExternalLink, Eye, FileText, GripVertical, Heading2, ImagePlus, Italic, Globe2, Shield, Link2, List, ListChecks, Loader2, LockKeyhole, Menu, Minus, Monitor, Palette, Plus, Quote, Redo2, Search, Send, Smartphone, Sparkles, SquareChevronDown, Trash2, Type, Undo2, Upload, X, Zap } from "lucide-react";
import { ACCENTS, THEMES, type Article, type Block, type BlockType, type TemplateKind, articleText, articleUrl, articleOutline, articleTemplate, blankArticle, normalizeArticle, normalizeSlug, readingTime, SITE_HOST, suggestSlug } from "@/lib/article";
import { ArticleView, articleStyle } from "./article-view";
import {clientFetch} from '@/lib/client-access';
import ArticleEndingEditor from './article-ending-editor';

type User = { userId: string; fullName: string | null; displayName: string };
type Tab = "text" | "design" | "link";
type ModalType = "publish" | "success" | "delete" | "discard" | "help" | "new" | "blocks" | "outline" | null;
type Props = { user: User | null; initial: Article; signIn: string; signOut: string; adminAllowed?: boolean; context?:'browser'|'telegram';entry?:{screen:'new'|'edit';articleId?:string} };
function AutoText(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => { const el = ref.current; if (el) { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; } }, [props.value]);
  return <textarea {...props} ref={ref} rows={1} />;
}
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const controls = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, textarea, [tabindex="0"]');
        if (!controls?.length) return;
        const first = controls[0], last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}><div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={close}><X size={20} /></button></div>{children}</div></div>;
}
async function jsonRequest(url: string, init?: RequestInit) {
  const response = await clientFetch(url, { cache: "no-store", ...init });
  let data: { error?: string; articles: Article[]; article: Article; available: boolean; url: string };
  try { data = await response.json() as typeof data; } catch { throw new Error("Сервер не ответил. Проверьте соединение и попробуйте ещё раз."); }
  if (!response.ok) throw new Error(data.error || "Не удалось выполнить действие.");
  return data;
}
function dateLabel(time?: number) {
  if (!time) return "Ещё не сохранено";
  return new Date(time).toLocaleDateString("ru", { day: "numeric", month: "short" });
}

export default function Editor({ user, initial, signIn, signOut, adminAllowed = false,context='browser',entry }: Props) {
  const homeHref=context==='telegram'?'/_list/app?screen=articles':'/';
  const [article, setArticle] = useState<Article>(initial), articleRef = useRef(initial);
  const [articles, setArticles] = useState<Article[]>([]);
  const [ready, setReady] = useState(false), [loaded, setLoaded] = useState(!user);
  const [loadError, setLoadError] = useState("");
  const [dirty, setDirty] = useState(false), dirtyRef = useRef(false);
  const [localStatus, setLocalStatus] = useState("На устройстве");
  const [tab, setTab] = useState<Tab>("text"), [preview, setPreview] = useState(false);
  const [phone, setPhone] = useState(false), [sidebarOpen, setSidebarOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "draft" | "published">("all"), [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false), saveLock = useRef(false), editRevision = useRef(0);
  const [uploading, setUploading] = useState(false), fileInput = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<string>("cover");
  const [activeBlock, setActiveBlock] = useState<string>(initial.blocks[0]?.id || "");
  const [blockMenu, setBlockMenu] = useState(""), [addMenu, setAddMenu] = useState(false), [moreOpen, setMoreOpen] = useState(false);
  const focusedArea = useRef<HTMLTextAreaElement | null>(null);
  const [modal, setModal] = useState<ModalType>(null), pendingSwitch = useRef<(() => void) | null>(null);
  const [successArticle, setSuccessArticle] = useState<Article | null>(null);
  const [toast, setToast] = useState(""), toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [slugState, setSlugState] = useState<{ kind: "checking" | "ok" | "error" | "idle"; text: string }>({ kind: "idle", text: "Без даты и случайных символов" });
  const storageKey = (context==='telegram'?'list:telegram:draft:':'list:draft:') + (user?.userId || "guest");
  const undoStack = useRef<Article[]>([]), redoStack = useRef<Article[]>([]), lastUndoTime = useRef(0);
  const [historyCounts, setHistoryCounts] = useState([0, 0]), [keyboardOpen, setKeyboardOpen] = useState(false);
  function commit(next: Article, changed = true, remember = true) {
    const previous = articleRef.current;
    if (changed && JSON.stringify(previous) === JSON.stringify(next)) return;
    if (changed && remember) {
      const shapeChanged = previous.blocks.map((b) => b.id + b.type).join() !== next.blocks.map((b) => b.id + b.type).join();
      if (Date.now() - lastUndoTime.current > 700 || shapeChanged) undoStack.current = [...undoStack.current.slice(-39), previous];
      lastUndoTime.current = Date.now(); redoStack.current = [];
      setHistoryCounts([undoStack.current.length, 0]);
    }
    if (!changed && previous.id !== next.id) { undoStack.current = []; redoStack.current = []; setHistoryCounts([0,0]); }
    articleRef.current = next; setArticle(next);
    dirtyRef.current = changed; setDirty(changed);
    if (changed) editRevision.current += 1;
  }
  function patch(next: Partial<Article>) { commit({ ...articleRef.current, ...next }); }
  function undo(redo = false) {
    const source = redo ? redoStack.current : undoStack.current, target = redo ? undoStack.current : redoStack.current;
    const snapshot = source.pop();
    if (!snapshot) return;
    const current = articleRef.current;
    target.push(current);
    commit({ ...snapshot, id: current.id, version: current.version, published: current.published, createdAt: current.createdAt, updatedAt: current.updatedAt, views: current.views }, true, false);
    lastUndoTime.current = 0;
    setHistoryCounts([undoStack.current.length, redoStack.current.length]);
  }
  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }
  async function loadLibrary() {
    if (!user) return;
    setLoadError("");
    try { const data = await jsonRequest("/api/articles"); setArticles(data.articles); return data.articles as Article[]; }
    catch (e) { setLoadError(e instanceof Error ? e.message : "Не удалось загрузить статьи."); }
    finally { setLoaded(true); }
  }
  useEffect(() => {
    let restored = false;
    const targetId=entry?.articleId||new URLSearchParams(window.location.search).get('article');
    try {
      const raw = entry?.screen==='new'?null:localStorage.getItem(storageKey) || (context==='browser'&&user ? localStorage.getItem("list:draft:guest") : null);
      if (raw) {
        const saved = JSON.parse(raw), a = saved.article;
        if (a && (!targetId||a.id===targetId) && typeof a.title === "string" && typeof a.slug === "string" && Array.isArray(a.blocks) && a.blocks.length <= 200 && a.blocks.every((b: Block) => b && typeof b.id === "string" && typeof b.text === "string") && a.theme in THEMES) {
          commit(a, saved.dirty === true, false); restored = true;
        }
      }
    } catch {}
    setReady(true);
    if (user) loadLibrary().then((items) => {
      if(entry?.screen==='new')return;
      if(targetId&&!items?.some(a=>a.id===targetId)){setLoadError('Эта статья недоступна в вашем пространстве.');return;}
      if (!items?.length || dirtyRef.current) return;
      const latest = items.find((item) => item.id === (targetId||articleRef.current.id));
      if (latest) commit(latest, false);
      else if (!restored) commit(items[0], false);
    });
  // The workspace is loaded once per authenticated browser navigation.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const viewport = window.visualViewport;
    function updateViewport() {
      const target = document.activeElement;
      const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const open = !!viewport && window.innerWidth <= 1100 && viewport.scale === 1 && editing && window.innerHeight - viewport.height > 120;
      setKeyboardOpen(open);
      document.documentElement.style.setProperty("--workspace-height", open ? Math.round(viewport!.height) + "px" : "100dvh");
    }
    viewport?.addEventListener("resize", updateViewport);
    window.addEventListener("focusin", updateViewport);
    window.addEventListener("focusout", updateViewport);
    return () => { viewport?.removeEventListener("resize", updateViewport); window.removeEventListener("focusin", updateViewport); window.removeEventListener("focusout", updateViewport); document.documentElement.style.removeProperty("--workspace-height"); };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const persist = () => {
      try { localStorage.setItem(storageKey, JSON.stringify({ article: articleRef.current, dirty: dirtyRef.current })); setLocalStatus("На устройстве"); }
      catch { setLocalStatus("Сохраните в облако"); }
    };
    const timer = setTimeout(persist, 400);
    window.addEventListener("pagehide", persist);
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", persist); };
  }, [article, dirty, ready, storageKey]);
  useEffect(() => {
    if (tab !== "link") return;
    let slug: string;
    try { slug = normalizeSlug(article.slug || suggestSlug(article.title)); }
    catch (e) { setSlugState({ kind: "error", text: (e as Error).message }); return; }
    if (!user) { setSlugState({ kind: "idle", text: "Откройте редактор, чтобы проверить адрес" }); return; }
    setSlugState({ kind: "checking", text: "Проверяем адрес…" });
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const q = new URLSearchParams({ path: slug, id: article.id || "" });
        const data = await jsonRequest("/api/slug?" + q, { signal: controller.signal });
        setSlugState({ kind: data.available ? "ok" : "error", text: data.available ? "Адрес свободен для этой статьи" : "Этот адрес уже занят" });
      } catch (e) { if (!controller.signal.aborted) setSlugState({ kind: "error", text: (e as Error).message }); }
    }, 450);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [article.slug, article.title, article.id, tab, user]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void save(); } };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  async function save(publish?: boolean,quiet=false): Promise<Article | undefined> {
    if (saveLock.current || uploading) return;
    if (!user) { notify("Откройте главную страницу и нажмите «Начать писать»."); return; }
    const current = articleRef.current;
    let normalized: Article;
    try { normalized = normalizeArticle({ ...current, slug: quiet&&!current.id&&(!current.slug||current.slug===suggestSlug(current.title))?"draft-"+crypto.randomUUID():publish&&current.slug.startsWith("draft-")?suggestSlug(current.title):current.slug||suggestSlug(current.title), published: publish ?? current.published }); }
    catch (e) { if(!quiet)notify((e as Error).message); return; }
    saveLock.current = true; setBusy(true);
    const revision = editRevision.current;
    try {
      const data = await jsonRequest(current.id ? "/api/articles/" + current.id : "/api/articles", { method: current.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...normalized, version: current.version }) });
      const saved = data.article as Article;
      if (revision === editRevision.current) commit(saved, false);
      else commit({ ...articleRef.current, id: saved.id, version: saved.version, createdAt: saved.createdAt, updatedAt: saved.updatedAt, published: saved.published, views: saved.views }, true);
      setArticles((items) => [saved, ...items.filter((a) => a.id !== saved.id)]);
      try { if (user && localStorage.getItem("list:draft:guest")) localStorage.removeItem("list:draft:guest"); } catch {}
      if(!quiet)notify(saved.published ? "Статья опубликована. Ссылку можно открыть." : context==='telegram'?"Черновик сохранён в ваших статьях Telegram.":"Черновик сохранён в этом браузере.");
      return saved;
    } catch (e) { if(quiet)setLocalStatus('Черновик на устройстве — нажмите «Сохранить»');else notify((e as Error).message); }
    finally { saveLock.current = false; setBusy(false); }
  }
  useEffect(()=>{
    if(!ready||!loaded||!user||!dirty||article.published||!article.title.trim()||uploading)return;
    const timer=setTimeout(()=>{if(!saveLock.current)void save(false,true);},1800);
    return()=>clearTimeout(timer);
  // A draft is saved after a typing pause; published pages require explicit update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[article,dirty,ready,loaded,uploading,user]);
  function switchTo(next: Article) {
    if (uploading || saveLock.current) { notify("Дождитесь завершения загрузки или сохранения."); return; }
    const run = () => { commit(next, false); undoStack.current = []; redoStack.current = []; setHistoryCounts([0,0]); setPreview(false); setTab("text"); setSidebarOpen(false); setActiveBlock(next.blocks[0]?.id || ""); setMoreOpen(false); };
    if (dirtyRef.current) { pendingSwitch.current = run; setModal("discard"); } else run();
  }
  function newArticle() { setModal("new"); }
  function updateBlock(id: string, next: Partial<Block>) { patch({ blocks: articleRef.current.blocks.map((block) => block.id === id ? { ...block, ...next } : block) }); }
  function insertBlock(block: Block) {
    const blocks = [...articleRef.current.blocks], index = blocks.findIndex((b) => b.id === activeBlock);
    blocks.splice(index < 0 ? blocks.length : index + 1, 0, block);
    patch({ blocks }); setActiveBlock(block.id); setAddMenu(false);
    requestAnimationFrame(() => document.getElementById("block-" + block.id)?.focus());
  }
  function addBlock(type: BlockType) {
    if (articleRef.current.blocks.length >= 200) { notify("В статье может быть до 200 блоков."); return; }
    setModal(null); setPreview(false);
    if (type === "image") { selectUpload("new-image"); setAddMenu(false); return; }
    insertBlock({ id: crypto.randomUUID(), type, text: type === "button" ? "Открыть ссылку" : "", ...(type === "button" ? { url: "" } : {}), ...(type === "details" ? { label: "Подробнее" } : {}) });
  }
  function moveBlock(id: string, direction: number) {
    const blocks = [...articleRef.current.blocks], index = blocks.findIndex((b) => b.id === id), target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]]; patch({ blocks });
  }
  function removeBlock(id: string) {
    const blocks = articleRef.current.blocks.filter((b) => b.id !== id);
    if (!blocks.length) blocks.push({ id: crypto.randomUUID(), type: "paragraph", text: "" });
    patch({ blocks }); setBlockMenu("");
  }
  function format(mark: string) {
    const el = focusedArea.current, block = articleRef.current.blocks.find((b) => b.id === activeBlock);
    if (!el || !block || !["paragraph", "heading", "quote", "list", "summary", "details"].includes(block.type)) { notify("Выделите текст в блоке и выберите форматирование."); return; }
    const start = el.selectionStart, end = el.selectionEnd;
    if (start === end) { el.focus(); notify("Сначала выделите слово или фразу."); return; }
    updateBlock(block.id, { text: block.text.slice(0, start) + mark + block.text.slice(start, end) + mark + block.text.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + mark.length, end + mark.length); });
  }
  function selectUpload(target: string) {
    if (!user) { notify("Откройте редактор с главной страницы."); return; }
    uploadTarget.current = target; fileInput.current?.click();
  }
  async function upload(file: File) {
    if (file.size > 32 * 1024 * 1024) { notify("Выберите изображение меньше 32 МБ."); return; }
    setUploading(true);
    const target = uploadTarget.current;
    try {
      let chosen = file;
      if (file.type !== "image/gif") {
        try {
          const bitmap = await createImageBitmap(file);
          const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
          if (scale < 1 || file.size > 2 * 1024 * 1024) {
            const canvas = document.createElement("canvas"); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
            if (blob && blob.size < file.size) chosen = new File([blob], "image.webp", { type: blob.type });
          }
          bitmap.close();
        } catch {}
      }
      const form = new FormData(); form.set("file", chosen);
      const result = await jsonRequest("/api/uploads", { method: "POST", body: form });
      if (target === "cover") patch({ cover: result.url });
      else if (target === "share") patch({ shareImage: result.url });
      else if (target === "new-image") insertBlock({ id: crypto.randomUUID(), type: "image", text: "", url: result.url });
      else updateBlock(target, { url: result.url });
      notify("Изображение загружено.");
    } catch (e) { notify((e as Error).message); }
    finally { setUploading(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  async function copyLink(a = articleRef.current) {
    const saved = articles.find((item) => item.id === a.id) || a;
    if (!saved.id || !saved.published) { notify("Сначала опубликуйте статью."); return; }
    try { await navigator.clipboard.writeText(articleUrl(saved.slug)); notify("Ссылка скопирована."); }
    catch { notify("Откройте статью и скопируйте адрес из строки браузера."); }
  }
  function downloadMarkdown() {
    const a = articleRef.current;
    const body = ["# " + a.title, a.subtitle, a.author ? "*" + a.author + "*" : "", a.cover ? "![](" + a.cover + ")" : "", ...a.blocks.map((b) => b.type === "heading" ? "## " + b.text : b.type === "quote" ? b.text.split("\n").map((s) => "> " + s).join("\n") : b.type === "list" ? b.text.split("\n").map((s) => "- " + s).join("\n") : b.type === "summary" ? "## Суть за минуту\n\n" + b.text : b.type === "checklist" ? b.text.split("\n").filter(Boolean).map((s) => "- [ ] " + s).join("\n") : b.type === "details" ? "### " + (b.label || "Подробнее") + "\n\n" + b.text : b.type === "divider" ? "---" : b.type === "image" ? "![" + b.text + "](" + b.url + ")" : b.type === "button" ? "[" + b.text + "](" + b.url + ")" : b.text)].filter(Boolean).join("\n\n");
    const blob = new Blob([body], { type: "text/markdown;charset=utf-8" }), url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = suggestSlug(a.title) + ".md"; link.click(); URL.revokeObjectURL(url); setMoreOpen(false);
  }
  async function deleteArticle() {
    if (!article.id || saveLock.current || uploading) return;
    setBusy(true);
    try {
      await jsonRequest("/api/articles/" + article.id, { method: "DELETE" });
      setArticles((items) => items.filter((a) => a.id !== article.id)); commit(blankArticle(user?.fullName || ""), false); setModal(null); notify("Статья удалена.");
    } catch (e) { notify((e as Error).message); }
    finally { setBusy(false); }
  }
  const closeModal = () => { if (!saveLock.current) setModal(null); };
  const wordCount = articleText(article).trim().split(/\s+/).filter(Boolean).length;
  const filtered = articles.filter((a) => (filter === "all" || (filter === "published" ? a.published : !a.published)) && a.title.toLowerCase().includes(search.toLowerCase()));
  const shareImage = article.shareImage || article.cover;
  const shareTitle = article.shareTitle || article.title || "Название вашей истории";
  const shareDescription = article.shareDescription || article.subtitle || articleText(article).slice(0, 160);
  const tabs: { id: Tab; label: string; icon: typeof Type }[] = [{ id: "text", label: "Текст", icon: Type }, { id: "design", label: "Вид", icon: Palette }, { id: "link", label: "Ссылка", icon: Link2 }];
  const blockTypes: { type: BlockType; name: string; hint: string; icon: typeof Type }[] = [
    { type: "paragraph", name: "Текст", hint: "Основная часть вашей истории", icon: Type },
    { type: "heading", name: "Заголовок раздела", hint: "Автоматически попадёт в оглавление", icon: Heading2 },
    { type: "summary", name: "Суть за минуту", hint: "Главные мысли для тех, у кого мало времени", icon: Zap },
    { type: "checklist", name: "Чек-лист", hint: "Читатель сможет отмечать выполненное", icon: ListChecks },
    { type: "details", name: "Раскрывающийся блок", hint: "Примечания, источники и пояснения по нажатию", icon: SquareChevronDown },
    { type: "quote", name: "Цитата", hint: "Выделите важную мысль", icon: Quote },
    { type: "list", name: "Обычный список", hint: "Каждый пункт с новой строки", icon: List },
    { type: "image", name: "Фотография", hint: "Из галереи вашего устройства", icon: ImagePlus },
    { type: "button", name: "Кнопка со ссылкой", hint: "Приглашение к следующему действию", icon: ArrowUpRight },
    { type: "divider", name: "Разделитель", hint: "Небольшая пауза в истории", icon: Minus },
  ];
  const outline = articleOutline(article);
  function focusBlock(id: string) {
    setModal(null); setTab("text"); setPreview(false);
    requestAnimationFrame(() => { const element = document.getElementById("block-" + id); element?.scrollIntoView({ block: "center", behavior: "smooth" }); element?.focus({ preventScroll: true }); });
  }

  return <div className={"workspace workspace-v2 " + (keyboardOpen ? "keyboard-open" : "")}>
    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif" ref={fileInput} onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
    <header className="workspace-header">
      <div className="header-brand"><button className="icon-button mobile-only" aria-label="Мои статьи" onClick={() => setSidebarOpen(true)}><Menu size={21} /></button><a className="wordmark" href={homeHref}><span className="brand-icon">л</span>лист<span className="wordmark-dot">.</span></a><span className="brand-divider" /><span className="brand-caption">Публикации с характером</span></div>
      <div className="header-center"><span className="private-pill"><Globe2 size={12} />Публичный сервис</span></div>
      <div className="header-actions">
        <span className="save-status"><span className={dirty ? "status-dot dirty" : "status-dot"} />{busy ? "Сохраняем…" : dirty ? localStatus : article.id ? "Сохранено" : "На устройстве"}</span>
        {!user && <a href={signIn} target="_top" className="btn btn-light sign-in">Войти</a>}
        {article.published ? <a className="btn btn-ghost save-draft" href={context==='telegram'?'/_list/app?screen=read&article='+article.id:articleUrl((articles.find((item) => item.id === article.id) || article).slug)} target={context==='telegram'?undefined:'_blank'} rel="noopener noreferrer"><ExternalLink size={15} />Открыть</a> : <button className="btn btn-ghost save-draft" aria-label="Сохранить черновик" title="Сохранить черновик" onClick={() => void save()} disabled={busy || uploading}><Cloud size={16} /><span>Сохранить</span></button>}

      </div>
    </header>
    {sidebarOpen && <button className="sidebar-backdrop" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)} />}
    <aside className={"sidebar " + (sidebarOpen ? "sidebar-open" : "")}>
      <div className="sidebar-head"><span className="workspace-avatar">Л</span><div><strong>Моё пространство</strong><span>Идеи становятся историями</span></div><button className="icon-button mobile-only" aria-label="Закрыть меню" onClick={() => setSidebarOpen(false)}><X size={18} /></button></div>
      <button className="new-page" onClick={newArticle}><Plus size={17} />Новый лист</button>
      <div className="sidebar-section-label">БИБЛИОТЕКА</div>
      <nav className="library-filters" aria-label="Статьи">
        <button className={filter === "all" ? "selected" : ""} onClick={() => { setFilter("all"); setSidebarOpen(true); }}><FileText size={16} />Все страницы<span>{articles.length}</span></button>
        <button className={filter === "draft" ? "selected" : ""} onClick={() => setFilter("draft")}><BookOpen size={16} />Черновики<span>{articles.filter((a) => !a.published).length}</span></button>
        <button className={filter === "published" ? "selected" : ""} onClick={() => setFilter("published")}><Send size={16} />Опубликовано<span>{articles.filter((a) => a.published).length}</span></button>
      </nav>
      <div className="sidebar-pages-heading"><span className="sidebar-section-label">ВАШИ СТРАНИЦЫ</span><button className="icon-button small" title="Обновить список" aria-label="Обновить список" onClick={() => void loadLibrary()}><Cloud size={14} /></button></div>
      <label className="search-box"><Search size={14} /><input placeholder="Найти страницу" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Поиск по вашим статьям" /></label>
      <div className="page-list">
        {!loaded && <div className="sidebar-empty"><Loader2 className="spin" size={18} />Загружаем статьи…</div>}
        {loadError && <div className="sidebar-error">{loadError}<button onClick={() => void loadLibrary()}>Повторить</button></div>}
        {loaded && !filtered.length && !loadError && <div className="sidebar-empty"><FileText size={24} /><p>{search ? "По этому названию ничего нет" : filter !== "all" ? "Здесь пока пусто" : "Здесь появятся ваши страницы"}</p><span>{!user ? "Начните с нового листа" : "Начните с нового листа"}</span></div>}
        {filtered.map((a) => <button key={a.id} className={"page-list-item " + (article.id === a.id ? "current" : "")} onClick={() => switchTo(a)}><span className="page-mini" style={{ background: THEMES[a.theme].bg, color: THEMES[a.theme].text }}>{a.title.slice(0,1)}</span><span className="page-list-copy"><strong>{a.title}</strong><span><i className={a.published ? "published-dot" : ""} />{a.published ? "Опубликовано" : "Черновик"} · {dateLabel(a.updatedAt)}</span></span></button>)}
      </div>
      <div className="sidebar-bottom"><div className="sidebar-tip"><Sparkles size={18} /><strong>Ваша история.<br />Ваши правила.</strong><p>Настройте даже то, как ваша ссылка выглядит в переписке.</p><button onClick={() => { setTab("link"); setSidebarOpen(false); }}>Попробовать <ArrowRight size={14} /></button></div>{adminAllowed && <><a className="help-link" href="/_list/admin"><Shield size={16} />Управление сервисом</a><a className="help-link" href="/_list/telegram"><Link2 size={16} />Подключить Telegram</a></>}<a className="help-link" href="/_list/about"><Globe2 size={16} />О сервисе и данных</a><button className="help-link" onClick={() => setModal("help")}><CircleHelp size={16} />Как устроен Лист</button>{user && <a href={signOut} target="_top" className="account-link">Доступ к статьям</a>}<div className="sidebar-footer">ПИШИТЕ. ДЕЛИТЕСЬ. ОСТАВАЙТЕСЬ СОБОЙ.</div></div>
    </aside>
    <main className="editor-main">
      <div className="editor-topbar"><div className="breadcrumb"><button className="breadcrumb-plan" onClick={() => setModal("outline")}><List size={16} /><span>План статьи</span><i>{outline.length}</i></button><span className="draft-label">{article.published ? "Опубликован" : "Черновик"}</span></div><div className="topbar-tools"><button className="icon-button undo-control" title="Отменить изменение" aria-label="Отменить изменение" disabled={!historyCounts[0]} onClick={() => undo()}><Undo2 size={17} /></button><button className="icon-button undo-control" title="Вернуть изменение" aria-label="Вернуть изменение" disabled={!historyCounts[1]} onClick={() => undo(true)}><Redo2 size={17} /></button><button className={"icon-button " + (preview ? "active" : "")} title="Предпросмотр" aria-label="Предпросмотр" aria-pressed={preview} onClick={() => setPreview(!preview)}><Eye size={18} /></button><div className="menu-wrap"><button className="icon-button" title="Действия со статьёй" aria-label="Действия со статьёй" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}><Ellipsis size={20} /></button>{moreOpen && <div className="dropdown more-dropdown"><button onClick={() => { setModal("new"); setMoreOpen(false); }}><Plus size={15} />Новая статья по шаблону</button><button onClick={downloadMarkdown}><Download size={15} />Скачать Markdown</button><button onClick={() => { const a = articleRef.current; switchTo({ ...a, id: undefined, version: undefined, title: a.title + " — копия", slug: suggestSlug(a.title).slice(0, 45) + "-copy-" + crypto.randomUUID().slice(0,4), published: false, views: 0, createdAt: undefined, updatedAt: undefined }); setMoreOpen(false); }}><Copy size={15} />Создать копию</button><button disabled={!article.published} onClick={() => { void copyLink(); setMoreOpen(false); }}><Link2 size={15} />Скопировать ссылку</button>{article.published && <button onClick={() => { void save(false); setMoreOpen(false); }}><LockKeyhole size={15} />Снять с публикации</button>}{article.id && <button className="danger" onClick={() => { setModal("delete"); setMoreOpen(false); }}><Trash2 size={15} />Удалить статью</button>}</div>}</div></div></div>
      <div className="editor-modebar"><div className="editor-tabs" role="tablist" aria-label="Настройки страницы">{tabs.map(({ id, label, icon: Icon }, index) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "selected" : ""} onClick={() => { setTab(id); if (id === "text") setPreview(false); }}><span className="step-number">{index + 1}</span><Icon size={15} />{label}</button>)}</div><div className="device-toggle" aria-label="Ширина предпросмотра"><button aria-label="Компьютер" aria-pressed={!phone} className={!phone ? "selected" : ""} onClick={() => setPhone(false)}><Monitor size={15} /></button><button aria-label="Телефон" aria-pressed={phone} className={phone ? "selected" : ""} onClick={() => setPhone(true)}><Smartphone size={15} /></button></div></div>
      {preview && <div className="preview-notice"><Eye size={14} />Так вашу страницу увидит читатель<button onClick={() => setPreview(false)}>Вернуться к тексту <ArrowLeft size={13} /></button></div>}
      {!user && <div className="public-welcome"><div><strong>Напишите историю. Поделитесь ссылкой.</strong><p>Начните писать сразу. Ключ редактирования сохранится в этом браузере.</p></div><a href="/demo">Посмотреть пример <ArrowUpRight size={14} /></a></div>}
      {article.blocked && <div className="moderation-notice" role="status"><Shield size={18} /><p><strong>Статья снята с публикации.</strong>{article.blockedReason || "Проверьте содержание."} Можно редактировать и сохранять её как черновик.</p></div>}
      <div className={"canvas-scroll " + (phone ? "phone-mode" : "")}>
        {preview ? <div className="preview-canvas"><ArticleView article={article} preview /></div> : <div className="writing-canvas article-paper" style={articleStyle(article)}>
          <div className="writing-inner">
            {!article.id && article.title === "Искусство замечать" && <div className="example-label"><Sparkles size={12} />Это пример. Измените его или начните новый лист.</div>}
            <header className={"writing-heading align-" + article.alignment}>
              <div className="article-eyebrow"><span />МЕСТО ДЛЯ ВАШИХ ИСТОРИЙ</div>
              <AutoText aria-label="Название статьи" className="title-input" placeholder="У каждой истории есть начало…" maxLength={160} value={article.title} onChange={(e) => { const title = e.target.value; patch({ title, ...(!article.id && (!article.slug || article.slug === suggestSlug(article.title)) ? { slug: suggestSlug(title) } : {}) }); }} />
              <AutoText aria-label="Подзаголовок" className="subtitle-input" placeholder="Добавьте подзаголовок — если хочется" maxLength={500} value={article.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} />
              <div className="article-byline"><span className="author-initial">{(article.author || "А").slice(0,1)}</span><input aria-label="Имя автора" value={article.author} placeholder="Ваше имя" maxLength={80} onChange={(e) => patch({ author: e.target.value })} /><span className="byline-dot">·</span><span>{readingTime(article)} мин чтения</span></div>
            </header>
            {article.cover ? <div className="editable-cover"><img src={article.cover} alt="Обложка статьи" /><div className="cover-actions"><button onClick={() => selectUpload("cover")}><ImagePlus size={14} />Заменить</button><button aria-label="Удалить обложку" onClick={() => patch({ cover: "" })}><X size={15} /></button></div></div> : <button className="add-cover" onClick={() => selectUpload("cover")}><ImagePlus size={17} />Добавить обложку</button>}
            <div className="format-toolbar">
              <button className="toolbar-insert" onClick={() => setModal("blocks")}><Plus size={17} /><span>Добавить блок</span></button><i />
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => format("**")} title="Жирный — выделите текст" aria-label="Жирный"><Bold size={17} /></button>
              <button onMouseDown={(e) => e.preventDefault()} onClick={() => format("*")} title="Курсив — выделите текст" aria-label="Курсив"><Italic size={17} /></button>
              <button onClick={() => addBlock("image")} title="Добавить фотографию" aria-label="Добавить фотографию"><ImagePlus size={18} /></button>
            </div>
            <div className="editable-blocks article-body">
              {article.blocks.map((block, index) => <div className={"editable-block block-" + block.type + (activeBlock === block.id ? " focused" : "")} key={block.id} onClick={()=>setActiveBlock(block.id)} style={{background:block.background,color:block.color,...(block.color?{"--ink":block.color,"--muted":block.color,"--accent":block.color}:{})} as React.CSSProperties}>
                {activeBlock===block.id&&<div className="block-color-controls"><label>Фон<input type="color" aria-label="Фон этого блока" value={block.background||THEMES[article.theme].bg} onChange={e=>updateBlock(block.id,{background:e.target.value})}/></label><label>Текст<input type="color" aria-label="Цвет текста этого блока" value={block.color||THEMES[article.theme].text} onChange={e=>updateBlock(block.id,{color:e.target.value})}/></label><button onClick={()=>updateBlock(block.id,{background:undefined,color:undefined})}>Сбросить цвета</button></div>}
                <div className="block-controls"><button className="block-grip" aria-label="Настройки блока " title="Переместить или удалить блок" aria-expanded={blockMenu === block.id} onClick={() => { setBlockMenu(blockMenu === block.id ? "" : block.id); setActiveBlock(block.id); }}><GripVertical size={16} /></button>{blockMenu === block.id && <div className="dropdown block-dropdown"><button disabled={index === 0} onClick={() => moveBlock(block.id, -1)}><ArrowUp size={14} />Выше</button><button disabled={index === article.blocks.length - 1} onClick={() => moveBlock(block.id, 1)}><ArrowDown size={14} />Ниже</button><button className="danger" onClick={() => removeBlock(block.id)}><Trash2 size={14} />Удалить блок</button></div>}</div>
                {block.type === "divider" ? <hr className="article-divider" /> : block.type === "image" ? <figure><img src={block.url} alt={block.text} /><input className="caption-input" aria-label="Описание изображения" value={block.text} placeholder="Подпись к изображению" onFocus={() => setActiveBlock(block.id)} onChange={(e) => updateBlock(block.id, { text: e.target.value })} /><button className="replace-block-image" onClick={() => selectUpload(block.id)}><ImagePlus size={14} />Заменить</button></figure> : block.type === "button" ? <div className="button-block-edit"><label>ТЕКСТ КНОПКИ<input value={block.text} aria-label="Текст кнопки" maxLength={100} onChange={(e) => updateBlock(block.id, { text: e.target.value })} onFocus={() => setActiveBlock(block.id)} /></label><label>ССЫЛКА<input value={block.url || ""} type="url" aria-label="Адрес кнопки" placeholder="https://…" onChange={(e) => updateBlock(block.id, { url: e.target.value })} onFocus={() => setActiveBlock(block.id)} /></label></div> : ["summary", "details", "checklist"].includes(block.type) ? <div className="special-block-editor">
                  <div className="special-block-label">{block.type === "summary" ? <Zap size={15} /> : block.type === "checklist" ? <ListChecks size={15} /> : <SquareChevronDown size={15} />}<span>{block.type === "summary" ? "Суть за минуту" : block.type === "checklist" ? "Чек-лист для читателя" : "Раскрывающийся блок"}</span></div>
                  {block.type === "details" && <input className="details-label-input" aria-label="Заголовок раскрывающегося блока" value={block.label || ""} maxLength={120} placeholder="Например: источники и подробности" onChange={(e) => updateBlock(block.id, { label: e.target.value })} />}
                  <AutoText id={"block-" + block.id} className="block-textarea" value={block.text} maxLength={20000} placeholder={block.type === "summary" ? "Расскажите в нескольких предложениях, что важно запомнить из этой статьи." : block.type === "checklist" ? "Напишите каждый пункт с новой строки" : "Подробности, которые читатель сможет открыть по желанию…"} aria-label={block.type === "summary" ? "Краткая версия статьи" : block.type === "checklist" ? "Пункты чек-листа" : "Содержимое раскрывающегося блока"} onChange={(e) => updateBlock(block.id, { text: e.target.value })} onFocus={(e) => { setActiveBlock(block.id); focusedArea.current = e.currentTarget; }} />
                  <p className="special-block-hint">{block.type === "summary" ? "Читатель сможет переключаться между сутью и полным текстом." : block.type === "checklist" ? "Отметки у каждого читателя свои и сохраняются на его устройстве." : "На странице этот текст спрячется под заголовком и раскроется по нажатию."}</p>
                </div> : <AutoText id={"block-" + block.id} aria-label={block.type === "heading" ? "Заголовок раздела" : block.type === "quote" ? "Цитата" : block.type === "list" ? "Список: каждый пункт с новой строки" : "Текст статьи"} className="block-textarea" placeholder={block.type === "heading" ? "Заголовок раздела" : block.type === "quote" ? "Мысль, которую хочется выделить" : block.type === "list" ? "Каждый пункт с новой строки" : "Расскажите свою историю…"} value={block.text} maxLength={20000} onChange={(e) => updateBlock(block.id, { text: e.target.value })} onFocus={(e) => { setActiveBlock(block.id); focusedArea.current = e.currentTarget; }} />}
              </div>)}
            </div>
            <div className="add-block-area"><div className="add-line" /><button className="add-block-button" onClick={() => setModal("blocks")}><Plus size={17} />Добавить блок</button><div className="add-line" /></div>
            <ArticleEndingEditor value={article.footer} onChange={footer=>patch({footer})}/>
            <div className="canvas-footer"><span>{wordCount} слов · {readingTime(article)} мин чтения</span><span>Слова имеют значение <span>✳</span></span></div>
          </div>
        </div>}
        <div className="article-publish-bottom"><button className="btn btn-light" disabled={busy||uploading} onClick={()=>setPreview(!preview)}><Eye size={17}/>{preview?'Вернуться к тексту':'Предпросмотр'}</button><button className="btn btn-primary" onClick={()=>setModal('publish')} disabled={busy||uploading||article.blocked}>{busy?<Loader2 className="spin" size={18}/>:<Send size={18}/>}<span>{article.blocked?'Снята модератором':article.published?'Обновить статью':'Опубликовать статью'}</span></button></div>
      </div>
    </main>
    {tab !== "text" && <button className="inspector-backdrop" aria-label="Вернуться к тексту" onClick={() => setTab("text")} />}
    <aside className={"inspector inspector-" + tab}>
      <div className="inspector-heading"><div><span className="eyebrow">{tab === "link" ? "ПОСЛЕДНИЙ ШТРИХ" : tab === "design" ? "ВАШ СТИЛЬ" : "НАЧНИТЕ С ИДЕИ"}</span><h2>{tab === "link" ? "Ссылка с характером" : tab === "design" ? "Как выглядит ваш лист" : "Ваша статья"}</h2></div><button className="icon-button mobile-only" aria-label="Закрыть настройки" onClick={() => setTab("text")}><X size={19} /></button></div>
      <div className="inspector-content">
        {tab === "text" && <>
          <p className="panel-intro">Нажмите на текст, чтобы писать. Кнопка «Добавить блок» — для всего остального.</p>
          <div className="article-health"><span><CheckCircle2 size={14} />{wordCount} слов</span><span>{readingTime(article)} мин чтения</span></div>
          <div className="editor-outline-heading"><h3>План статьи</h3><span>{outline.length} разделов</span></div>
          {outline.length ? <nav className="editor-outline" aria-label="План статьи">{outline.map((item, i) => <button key={item.id} onClick={() => focusBlock(item.blockId)}><span>{i + 1}</span>{item.title}</button>)}</nav> : <p className="outline-empty">Добавьте заголовки разделов — оглавление для читателей соберётся автоматически.</p>}
          <div className="smart-block-shortcuts"><button onClick={() => addBlock("summary")}><Zap size={16} /><span>Суть за минуту</span><Plus size={13} /></button><button onClick={() => addBlock("checklist")}><ListChecks size={16} /><span>Чек-лист</span><Plus size={13} /></button><button onClick={() => addBlock("details")}><SquareChevronDown size={16} /><span>Пояснение по нажатию</span><Plus size={13} /></button></div>
          <div className="panel-divider" />
          <label className="field-label">Автор<input className="field" placeholder="Ваше имя или название канала" value={article.author} maxLength={80} onChange={(e) => patch({ author: e.target.value })} /></label>
          <div className="cover-setting"><div><strong>Обложка статьи</strong><span>Задайте настроение истории</span></div><button className="icon-button bordered" aria-label="Загрузить обложку" onClick={() => selectUpload("cover")} disabled={uploading}><Upload size={16} /></button></div>
          {article.cover && <img className="cover-small" src={article.cover} alt="Текущая обложка" />}
          <button className="btn btn-light full" onClick={() => setPreview(!preview)}><Eye size={15} />{preview ? "Вернуться в редактор" : "Посмотреть глазами читателя"}</button>
          <div className="autosave-note"><Cloud size={16} /><p>Черновик сохраняется автоматически. В Telegram он доступен вам на разных устройствах; в обычном браузере — только в этом браузере.</p></div>
          {article.id && <div className="article-stats"><span>Просмотры <strong>{article.views || 0}</strong></span><span>Изменено <strong>{dateLabel(article.updatedAt)}</strong></span></div>}
        </>}
        {tab === "design" && <>
          <p className="panel-intro">Немного деталей — и история звучит по-вашему.</p>
          <div className="setting-group"><span className="field-label">Настроение страницы</span><div className="theme-grid">{Object.entries(THEMES).map(([key, theme]) => <button key={key} className={"theme-option " + (article.theme === key ? "selected" : "")} onClick={() => patch({ theme: key as Article["theme"], background:"", ...(key === "ink" && article.accent === "#a34e32" ? { accent: "#bb8b32" } : {}) })} aria-pressed={article.theme === key}><span className="theme-sample" style={{ background: theme.bg, color: theme.text }}><span>Aa</span><i /><i /><span className="theme-check">{article.theme === key && <Check size={13} />}</span></span><span>{theme.name}</span></button>)}</div></div>
          <div className="setting-group"><span className="field-label">Общий фон статьи</span><div className="color-options">{['#fdfcf9','#ffffff','#f4ecdd','#eef2eb','#e9eff8','#f6e9ef','#1d2925'].map(color=><button key={color} style={{background:color}} aria-label={'Фон статьи '+color} aria-pressed={article.background===color} onClick={()=>patch({background:color})}/>)}<input type="color" aria-label="Свой цвет фона статьи" value={article.background||THEMES[article.theme].bg} onChange={e=>patch({background:e.target.value})}/></div><button className="text-action" onClick={()=>patch({background:''})}>Вернуть фон темы</button></div>
          <div className="setting-group"><span className="field-label">Шрифт</span><div className="font-options"><button className={article.font === "serif" ? "selected" : ""} onClick={() => patch({ font: "serif" })}><span className="serif">Aa</span><span>Книжный</span></button><button className={article.font === "sans" ? "selected" : ""} onClick={() => patch({ font: "sans" })}><span>Aa</span><span>Современный</span></button></div></div>
          <div className="setting-group"><span className="field-label">Цвет акцентов</span><div className="color-options">{ACCENTS.map((color) => <button key={color} style={{ background: color }} className={article.accent === color ? "selected" : ""} aria-label={"Выбрать цвет " + color} aria-pressed={article.accent === color} onClick={() => patch({ accent: color })}>{article.accent === color && <Check size={13} />}</button>)}<label className="custom-color" title="Свой цвет"><Plus size={14} /><input type="color" aria-label="Свой цвет акцентов" value={article.accent} onChange={(e) => patch({ accent: e.target.value })} /></label></div></div>
          <div className="setting-group inline-setting"><span className="field-label">Заголовок</span><div className="segmented"><button className={article.alignment === "left" ? "selected" : ""} aria-label="Заголовок слева" onClick={() => patch({ alignment: "left" })}><AlignLeft size={17} /></button><button className={article.alignment === "center" ? "selected" : ""} aria-label="Заголовок по центру" onClick={() => patch({ alignment: "center" })}><AlignCenter size={17} /></button></div></div>
          <div className="setting-group inline-setting"><div><span className="field-label">Широкий лист</span><p className="field-hint">Больше пространства для текста</p></div><button className={"switch " + (article.wide ? "on" : "")} role="switch" aria-checked={article.wide} aria-label="Широкий лист" onClick={() => patch({ wide: !article.wide })}><span /></button></div>
          <button className="btn btn-light full" onClick={() => setPreview(!preview)}><Eye size={15} />{preview ? "К редактированию" : "Предпросмотр страницы"}</button>
          <p className="small-note">Оформление меняется на листе сразу. Опубликуйте изменения, когда будете готовы.</p>
        </>}
        {tab === "link" && <>
          <p className="panel-intro">Пусть ваша история начинается ещё до перехода по ссылке.</p>
          <label className="field-label">Адрес страницы<span className="domain-prefix">{SITE_HOST}/</span><div className="slug-input"><Link2 size={15} /><input aria-label="Свой адрес страницы" value={article.slug.startsWith("draft-")?suggestSlug(article.title):article.slug} placeholder={suggestSlug(article.title)} maxLength={120} onChange={(e) => patch({ slug: e.target.value })} onBlur={() => { try { patch({ slug: normalizeSlug(article.slug || suggestSlug(article.title)) }); } catch {} }} /></div></label>
          <div className={"slug-status " + slugState.kind} aria-live="polite">{slugState.kind === "checking" ? <Loader2 className="spin" size={13} /> : slugState.kind === "ok" ? <CheckCircle2 size={13} /> : <span />}{slugState.text}</div>
          <p className="field-hint address-hint">Например: moya-istoriya или vi/заметки. При смене адреса старые ссылки продолжат работать.</p>
          <div className="panel-divider" />
          <div className="setting-title"><h3>Карточка в мессенджерах</h3><span>Как увидят вашу ссылку</span></div>
          <label className="field-label">Заголовок карточки<input className="field" value={article.shareTitle} maxLength={120} placeholder={article.title || "Можно отличаться от названия статьи"} onChange={(e) => patch({ shareTitle: e.target.value })} /><span className="field-counter">{article.shareTitle.length}/120</span></label>
          <label className="field-label">Описание<textarea className="field field-textarea" value={article.shareDescription} maxLength={300} placeholder={article.subtitle || "Пара строк, чтобы захотелось открыть"} onChange={(e) => patch({ shareDescription: e.target.value })} /><span className="field-counter">{article.shareDescription.length}/300</span></label>
          <div className="cover-setting"><div><strong>Изображение карточки</strong><span>{article.shareImage ? "Отдельная обложка" : "Пока используем обложку статьи"}</span></div><button className="icon-button bordered" aria-label="Загрузить изображение карточки" onClick={() => selectUpload("share")} disabled={uploading}><Upload size={16} /></button></div>
          {article.shareImage && <button className="text-action" onClick={() => patch({ shareImage: "" })}>Использовать обложку статьи</button>}
          <div className="link-preview-label"><span className="status-dot" />ПРЕДПРОСМОТР КАРТОЧКИ</div>
          <div className="messenger-preview"><div className="message-card"><div className="message-card-text"><span className="message-site">Лист</span><strong>{shareTitle}</strong><p>{shareDescription}</p></div>{shareImage && <img src={shareImage} alt="Обложка карточки ссылки" />}<div className="message-domain">{SITE_HOST}</div></div><span className="message-time">только что <Check size={12} /></span></div>
          <p className="small-note">Окончательный вид карточки определяет мессенджер. Уже отправленные ссылки могут хранить прежнюю обложку в кеше.</p>
          <button className="btn btn-light full" onClick={() => void copyLink()} disabled={!article.published}><Copy size={15} />Скопировать опубликованную ссылку</button>
        </>}
      </div>
      <div className="inspector-footer"><Globe2 size={12} />Статьи открываются без входа</div>
    </aside>
    <nav className="mobile-tabs" aria-label="Редактор">{tabs.map(({ id, label, icon: Icon }) => <button key={id} className={tab === id ? "selected" : ""} onClick={() => { setTab(id); if (id === "text") setPreview(false); }}><Icon size={19} /><span>{label}</span></button>)}<button className={preview ? "selected" : ""} onClick={() => { setPreview(!preview); setTab("text"); }}><Eye size={19} /><span>Смотреть</span></button></nav>
    {toast && <div className="toast" role="status"><span>{toast}</span><button aria-label="Скрыть уведомление" onClick={() => setToast("")}><X size={16} /></button></div>}
    {uploading && <div className="upload-status" role="status"><Loader2 className="spin" size={16} />Загружаем изображение…</div>}
    {modal && <Modal title={modal === "publish" ? article.published ? "Обновить вашу историю" : "Пора поделиться историей" : modal === "success" ? "У вашей истории есть адрес" : modal === "delete" ? "Удалить этот лист?" : modal === "discard" ? "Есть несохранённые изменения" : modal === "new" ? "С чего начнём?" : modal === "blocks" ? "Что добавим в статью?" : modal === "outline" ? "План вашей статьи" : "Добро пожаловать в Лист"} close={closeModal}>
      {modal === "new" && <><p className="modal-intro">Чистый лист или готовая структура. Текст и оформление всегда можно изменить.</p><div className="template-picker">{([{ kind: "blank", name: "С чистого листа", hint: "Только вы и ваша идея", icon: FileText }, { kind: "article", name: "Статья-разбор", hint: "Суть, аргументы, выводы и источники", icon: BookOpen }, { kind: "guide", name: "Пошаговая инструкция", hint: "Подготовка, действия и проверка результата", icon: ListChecks }, { kind: "story", name: "Личная история", hint: "Начало, поворот и то, что изменилось", icon: Quote }] as { kind: TemplateKind; name: string; hint: string; icon: typeof Type }[]).map(({ kind, name, hint, icon: Icon }) => <button key={kind} onClick={() => { setModal(null); switchTo(articleTemplate(kind, user?.fullName || "")); }}><Icon size={22} /><span><strong>{name}</strong><small>{hint}</small></span><ArrowUpRight size={17} /></button>)}</div></>}
      {modal === "blocks" && <><p className="modal-intro">Блок появится после того, в котором вы сейчас пишете. Его можно переместить за значок слева.</p><div className="block-picker">{blockTypes.map(({ type, name, hint, icon: Icon }) => <button key={type} onClick={() => addBlock(type)}><span className={"block-picker-icon type-" + type}><Icon size={21} /></span><span><strong>{name}</strong><small>{hint}</small></span><Plus size={15} /></button>)}</div></>}
      {modal === "outline" && <><p className="modal-intro">Заголовки превращаются в оглавление. Нажмите на раздел, чтобы перейти к нему в редакторе.</p>{outline.length ? <nav className="editor-outline modal-outline">{outline.map((item, i) => <button key={item.id} onClick={() => focusBlock(item.blockId)}><span>{i + 1}</span>{item.title}<ArrowUpRight size={15} /></button>)}</nav> : <div className="empty-outline"><List size={28} /><p>В статье пока нет разделов.</p><button className="btn btn-primary" onClick={() => addBlock("heading")}>Добавить первый заголовок</button></div>}<button className="btn btn-light full" onClick={() => setModal("blocks")}><Plus size={16} />Добавить другой блок</button></>}
      {modal === "publish" && <><p className="modal-intro">Текст, оформление и карточка ссылки будут сохранены вместе.</p><div className="publish-summary"><span className="publish-thumbnail" style={{ background: THEMES[article.theme].bg, color: THEMES[article.theme].text }}>Aa</span><div><strong>{article.title || "Без названия"}</strong><span>{wordCount} слов · {readingTime(article)} мин чтения</span></div></div><label className="field-label">Ссылка на вашу страницу<span className="domain-prefix">{SITE_HOST}/</span><input className="field" value={article.slug.startsWith("draft-")?suggestSlug(article.title):article.slug} placeholder={suggestSlug(article.title)} onChange={(e) => patch({ slug: e.target.value })} /></label><div className="private-note"><Globe2 size={17} /><p><strong>Статья будет доступна всем по ссылке</strong>Для чтения не нужен доступ. Черновики не публикуются. После изменения адреса старые ссылки продолжат работать.</p></div>{!user && <a href={signIn} target="_top" className="btn btn-primary full">Открыть доступ к статьям <ArrowUpRight size={15} /></a>}{user && <div className="modal-actions"><button className="btn btn-light" disabled={busy} onClick={() => setModal(null)}>Ещё поправлю</button><button className="btn btn-primary" disabled={busy || uploading} onClick={async () => { const saved = await save(true); if (saved) { setSuccessArticle(saved); setModal("success"); } }}>{busy ? <Loader2 className="spin" size={16} /> : <ArrowUpRight size={16} />}{article.published ? "Сохранить изменения" : "Опубликовать"}</button></div>}</>}
      {modal === "success" && successArticle && <><div className="success-symbol"><Check size={30} /></div><p className="modal-intro">«{successArticle.title}» сохранена и доступна по своей ссылке.</p><div className="published-url"><span>{articleUrl(successArticle.slug)}</span><button className="icon-button" aria-label="Скопировать ссылку" onClick={() => void copyLink(successArticle)}><Copy size={17} /></button></div><div className="modal-actions"><button className="btn btn-light" onClick={() => setModal(null)}>К редактору</button><a href={articleUrl(successArticle.slug)} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Открыть страницу <ArrowUpRight size={16} /></a></div></>}
      {modal === "delete" && <><p className="modal-intro">Статья «{article.title}» и её адреса будут удалены. Отменить это действие не получится.</p><div className="modal-actions"><button className="btn btn-light" onClick={() => setModal(null)} disabled={busy}>Оставить</button><button className="btn btn-danger" onClick={() => void deleteArticle()} disabled={busy}>{busy ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />}Удалить</button></div></>}
      {modal === "discard" && <><p className="modal-intro">Сохраните текущий лист перед переходом, чтобы не потерять текст и настройки.</p><div className="modal-actions stacked"><button className="btn btn-primary" disabled={busy} onClick={async () => { const saved = await save(); if (saved && !dirtyRef.current) { setModal(null); pendingSwitch.current?.(); } else if (saved) { notify("Пока шло сохранение, вы добавили изменения. Сохраните их перед переходом."); } }}>{busy && <Loader2 className="spin" size={15} />}Сохранить и перейти</button><button className="btn btn-light" onClick={() => { setModal(null); pendingSwitch.current?.(); }}>Перейти без сохранения</button><button className="text-action" onClick={() => setModal(null)}>Остаться на этом листе</button></div></>}
      {modal === "help" && <div className="help-body"><p>Лист — простой способ превратить текст в самостоятельную страницу.</p><h3>Пишите с телефона</h3><p>Добавляйте текст, цитаты, фотографии, списки и кнопки. Внизу — вкладки оформления и настройки ссылки.</p><h3>Сделайте ссылку своей</h3><p>Выберите путь, например /vi/istoriya. Отдельно задайте заголовок, описание и обложку карточки в мессенджерах. Изменение пути не ломает старые ссылки.</p><h3>Больше, чем обычный текст</h3><p>Добавляйте «Суть за минуту», интерактивные чек-листы и раскрывающиеся пояснения. Заголовки сами образуют оглавление. У читателя есть заметки, ссылки на разделы и возврат к месту чтения.</p><h3>Сохраняйте и возвращайтесь</h3><p>Черновик сохраняется автоматически после паузы в наборе. Статьи из Telegram доступны через бота на разных устройствах. Статьи обычного браузера остаются в этом же браузере, пока сохранены данные сайта.</p><h3>Свой домен</h3><p>Сейчас страницы используют адрес сервиса. Для другого домена понадобится домен, которым вы владеете, и его подключение.</p><div className="private-note"><Globe2 size={17} /><p>Читать опубликованные статьи можно без входа. Для публикации не нужны регистрация и пароль. <a href="/_list/about">Подробнее о сервисе и данных</a>.</p></div><button className="btn btn-primary full" onClick={() => setModal(null)}>Начать свою историю <ArrowRight size={16} /></button></div>}
    </Modal>}
  </div>;
}
