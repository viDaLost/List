export type ReaderNote = { id: string; quote: string; text: string; section: string; createdAt: number };
export function parseNotes(raw: string | null): ReaderNote[] {
  try {
    const data: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((n) => n && typeof n.id === "string" && typeof n.text === "string" && typeof n.quote === "string" && typeof n.createdAt === "number" && Number.isFinite(n.createdAt) && typeof n.section === "string")
      .slice(-50).map((n) => ({ id: n.id.slice(0, 80), text: n.text.slice(0, 2000), quote: n.quote.slice(0, 1200), section: /^section-[\w-]{1,64}$/.test(n.section) ? n.section : "", createdAt: n.createdAt }));
  } catch { return []; }
}
function hash(text: string): string {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0).toString(36);
}
export function checklistItems(text: string) {
  const seen = new Map<string, number>();
  return text.split("\n").map((line) => line.replace(/^\s*(?:[-•]\s*|\[[ xX]\]\s*)/, "").trim()).filter(Boolean).map((label) => {
    const count = seen.get(label) || 0; seen.set(label, count + 1);
    return { id: hash(label) + "-" + count, label };
  });
}
export function parseProgress(raw: string | null): { fraction: number; section: string } | null {
  try {
    const data = JSON.parse(raw || "null");
    if (!data || typeof data.fraction !== "number" || !Number.isFinite(data.fraction)) return null;
    return { fraction: Math.min(1, Math.max(0, data.fraction)), section: typeof data.section === "string" && /^section-[\w-]{1,64}$/.test(data.section) ? data.section : "" };
  } catch { return null; }
}
export function notesMarkdown(title: string, url: string, notes: ReaderNote[]): string {
  return "# Заметки к статье «" + title + "»\n\n" + url + "\n\n" + notes.map((note) => (note.quote ? note.quote.split("\n").map((s) => "> " + s).join("\n") + "\n\n" : "") + note.text + (note.section ? "\n\n[Вернуться к фрагменту](" + url + "#" + note.section + ")" : "")).join("\n\n---\n\n");
}
