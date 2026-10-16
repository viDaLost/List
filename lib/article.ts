export const SITE_ORIGIN = "https://lista-studio.vitaledanilov.chatgpt.site";
export const SITE_HOST = new URL(SITE_ORIGIN).hostname;
export const THEMES = {
  paper: { name: "Бумага", bg: "#fdfcf9", text: "#252c27", muted: "#7b7d72" },
  sand: { name: "Песок", bg: "#f4ecdd", text: "#453b31", muted: "#8b7c68" },
  sage: { name: "Шалфей", bg: "#eef2eb", text: "#283f34", muted: "#718273" },
  ink: { name: "Чернила", bg: "#1d2925", text: "#f1eee5", muted: "#a0aea5" },
} as const;
export const ACCENTS = ["#a34e32", "#3c6550", "#385d8a", "#8c5696", "#bb8b32", "#ce6f69"];
export const BLOCK_TYPES = ["paragraph", "heading", "quote", "list", "image", "divider", "button", "summary", "checklist", "details"] as const;
export type BlockType = typeof BLOCK_TYPES[number];
export type Block = { id: string; type: BlockType; text: string; url?: string; label?: string };
export type Article = {
  id?: string; title: string; subtitle: string; author: string; slug: string; blocks: Block[];
  cover: string; theme: keyof typeof THEMES; font: "serif" | "sans"; accent: string;
  alignment: "left" | "center"; wide: boolean; shareTitle: string; shareDescription: string; shareImage: string;
  published: boolean; views?: number; version?: number; createdAt?: number; updatedAt?: number;
  blocked?: boolean; blockedReason?: string;
};
export class InputError extends Error {}
const reserved = new Set(["api", "media", "demo", "help", "signin-with-chatgpt", "signout-with-chatgpt", "callback", "favicon", "robots", "sitemap", "_next", "assets"]);
export function normalizeSlug(input: string): string {
  const result = input.normalize("NFC").trim().toLowerCase().replace(/^\/+|\/+$/g, "");
  if (!result || result.length > 120) throw new InputError("Адрес должен содержать от 1 до 120 символов.");
  const parts = result.split("/");
  if (parts.length > 3 || parts.some((part) => part.length > 60 || !/^[a-z0-9а-яё]+(?:-[a-z0-9а-яё]+)*$/u.test(part))) throw new InputError("Используйте буквы, цифры и дефисы. Можно до трёх частей через /.");
  if (reserved.has(parts[0])) throw new InputError("Этот адрес используется сервисом. Выберите другой.");
  return result;
}
export function suggestSlug(input: string): string {
  const letters: Record<string, string> = { а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"yo",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"ts",ч:"ch",ш:"sh",щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya" };
  const result = input.toLowerCase().split("").map((c) => letters[c] ?? c).join("").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 55).replace(/-+$/g, "");
  return !result || reserved.has(result) ? "moya-istoriya" : result;
}
export function safeUrl(input: string, image = false): string {
  if (!input) return "";
  const value = input.trim();
  if (/^\/(?:media\/[a-f0-9-]{36}|covers\/[a-z0-9-]+\.png)$/i.test(value)) return value;
  try {
    const u = new URL(value);
    if (u.username || u.password) return "";
    return (image ? ["https:"] : ["https:", "http:", "mailto:", "tel:", "tg:"]).includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}
function field(obj: Record<string, unknown>, key: string, limit: number, fallback = ""): string {
  const value = obj[key] ?? fallback;
  if (typeof value !== "string" || value.length > limit) throw new InputError("Поле «" + key + "» слишком длинное или имеет неверный формат.");
  return value.trim();
}
export function normalizeArticle(input: unknown): Article {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new InputError("Не удалось прочитать статью.");
  const obj = input as Record<string, unknown>, title = field(obj, "title", 160);
  if (!title) throw new InputError("Добавьте название статьи.");
  if (!Array.isArray(obj.blocks) || obj.blocks.length > 200) throw new InputError("В статье может быть до 200 блоков.");
  const ids = new Set<string>();
  const blocks: Block[] = obj.blocks.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new InputError("Повреждённый блок статьи.");
    const block = item as Record<string, unknown>;
    if (!BLOCK_TYPES.includes(block.type as BlockType)) throw new InputError("Неизвестный тип блока.");
    const text = typeof block.text === "string" ? block.text : "", type = block.type as BlockType;
    if (text.length > 20000) throw new InputError("Разделите длинный текст на несколько блоков.");
    const url = safeUrl(typeof block.url === "string" ? block.url : "", type === "image");
    if ((type === "image" || type === "button") && !url) throw new InputError("Укажите корректную ссылку в блоке изображения или кнопки.");
    let id = typeof block.id === "string" && /^[\w-]{1,64}$/.test(block.id) ? block.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    if (block.label !== undefined && (typeof block.label !== "string" || block.label.length > 120)) throw new InputError("Название раскрывающегося блока должно быть короче 120 символов.");
    return { id, type, text, ...(url ? { url } : {}), ...(type === "details" ? { label: typeof block.label === "string" && block.label.trim() ? block.label.trim() : "Подробнее" } : {}) };
  });
  if (JSON.stringify(blocks).length > 200000) throw new InputError("Статья слишком большая: сократите текст.");
  if (!blocks.some((b) => b.text.trim() || b.type === "image")) throw new InputError("Добавьте текст или изображение.");
  const theme = obj.theme as keyof typeof THEMES;
  if (!Object.prototype.hasOwnProperty.call(THEMES, theme)) throw new InputError("Неизвестная тема оформления.");
  const accent = field(obj, "accent", 7, "#a34e32");
  if (!/^#[0-9a-f]{6}$/i.test(accent)) throw new InputError("Укажите цвет в формате #AABBCC.");
  const coverInput = field(obj, "cover", 2048), shareImageInput = field(obj, "shareImage", 2048);
  const cover = safeUrl(coverInput, true), shareImage = safeUrl(shareImageInput, true);
  if ((coverInput && !cover) || (shareImageInput && !shareImage)) throw new InputError("Изображение должно использовать HTTPS.");
  return {
    title, author: field(obj, "author", 80, "Автор"), subtitle: field(obj, "subtitle", 500),
    slug: normalizeSlug(field(obj, "slug", 120)), blocks, cover, theme,
    font: obj.font === "sans" ? "sans" : "serif", accent, alignment: obj.alignment === "center" ? "center" : "left",
    wide: obj.wide === true, shareTitle: field(obj, "shareTitle", 120), shareDescription: field(obj, "shareDescription", 300), shareImage, published: obj.published === true,
  };
}
export function articleText(article: Pick<Article, "blocks">): string {
  return article.blocks.filter((b) => !["image", "divider", "button"].includes(b.type)).map((b) => b.text).join(" ").replace(/\*\*?|\[([^\]]+)\]\([^)]+\)/g, "$1");
}
export function readingTime(article: Pick<Article, "blocks">): number {
  return Math.max(1, Math.ceil(articleText(article).split(/\s+/).filter(Boolean).length / 180));
}
export function articleUrl(slug: string): string { return SITE_ORIGIN + "/" + slug.split("/").map(encodeURIComponent).join("/"); }
export function blankArticle(author = ""): Article {
  return { title: "", subtitle: "", author, slug: "", blocks: [{ id: crypto.randomUUID(), type: "paragraph", text: "" }], cover: "", theme: "paper", font: "serif", accent: "#a34e32", alignment: "left", wide: false, shareTitle: "", shareDescription: "", shareImage: "", published: false };
}
export function demoArticle(author = "Редакция Листа"): Article {
  return {
    ...blankArticle(author), title: "Искусство замечать", subtitle: "Маленькая история о том, как вернуть внимание к собственной жизни.", slug: "iskusstvo-zamechat", cover: "/covers/stillness.png",
    shareTitle: "Замедлиться. Посмотреть. Заметить.", shareDescription: "Иногда самое интересное происходит там, где мы перестали смотреть. Несколько мыслей о внимании к простым вещам.",
    blocks: [
      { id: "essence", type: "summary", text: "Вдохновение часто рядом: замедлитесь, посмотрите на знакомое место по-новому и запишите одну замеченную деталь." },
      { id: "intro", type: "paragraph", text: "Мы привыкли искать вдохновение где-то далеко. В новых городах, больших событиях, чужих историях. Но иногда достаточно просто чуть медленнее пройти знакомой дорогой." },
      { id: "quote", type: "quote", text: "Внимание — это самый простой способ сделать обычный день особенным." },
      { id: "heading", type: "heading", text: "Начните с простого" },
      { id: "body", type: "paragraph", text: "Заметить, как свет ложится на стену. Услышать разговор за соседним столиком. Сохранить мысль, которая появилась по дороге домой. У каждой такой детали есть своя история — и место на вашем листе." },
      { id: "list", type: "checklist", text: "Оставьте пять минут без телефона.\nПосмотрите на привычное место по-новому.\nЗапишите одну мысль, которую хочется сохранить." },
      { id: "extra", type: "details", label: "Небольшой эксперимент на завтра", text: "Выберите один знакомый маршрут и попробуйте найти на нём три детали, которые раньше не замечали. Не нужно ничего оценивать — просто запомните их." },
    ],
  };
}
export function sectionId(blockId: string): string { return "section-" + blockId; }
export function articleOutline(article: Pick<Article, "blocks">) {
  return article.blocks.filter((b) => b.type === "heading" && b.text.trim()).map((b) => ({ id: sectionId(b.id), blockId: b.id, title: articleText({ blocks: [b] }) }));
}
export type TemplateKind = "blank" | "article" | "guide" | "story";
export function articleTemplate(kind: TemplateKind, author = ""): Article {
  const a = blankArticle(author);
  if (kind === "blank") return a;
  const block = (type: BlockType, text = "", label?: string): Block => ({ id: crypto.randomUUID(), type, text, ...(label ? { label } : {}) });
  return {
    ...a,
    blocks: kind === "article" ? [
      block("summary", ""), block("paragraph", ""), block("heading", "Главная мысль"), block("paragraph", ""),
      block("heading", "Почему это важно"), block("paragraph", ""), block("details", "", "Источники и подробности"), block("heading", "Что взять с собой"), block("paragraph", ""),
    ] : kind === "guide" ? [
      block("summary", ""), block("heading", "Что понадобится"), block("checklist", ""), block("heading", "Шаг за шагом"), block("paragraph", ""),
      block("details", "", "Если что-то не получается"), block("heading", "Проверьте результат"), block("checklist", ""),
    ] : [block("paragraph", ""), block("heading", "С чего всё началось"), block("paragraph", ""), block("quote", ""), block("heading", "Что изменилось"), block("paragraph", "")],
  };
}
