"use client";
import { useEffect, useState } from "react";
import { Check, Link2 } from "lucide-react";
import { checklistItems } from "@/lib/reading";
export function ReaderChecklist({ text, storageKey }: { text: string; storageKey?: string }) {
  const items = checklistItems(text);
  const [checked, setChecked] = useState<string[]>([]), [storageError, setStorageError] = useState(false);
  useEffect(() => {
    setChecked([]);
    if (!storageKey) return;
    try { const data = JSON.parse(localStorage.getItem(storageKey) || "[]"); if (Array.isArray(data)) setChecked(data.filter((x) => typeof x === "string" && items.some((i) => i.id === x))); } catch {}
  // Every checklist has an isolated key; item content determines its identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, text]);
  function toggle(id: string) {
    const next = checked.includes(id) ? checked.filter((s) => s !== id) : [...checked, id];
    setChecked(next);
    if (storageKey) { try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { setStorageError(true); } }
  }
  return <div className="reader-checklist"><div className="checklist-heading"><span>ЧЕК-ЛИСТ</span><span>{checked.length} / {items.length}</span></div><ul>{items.map(({ id, label }) => <li key={id}><label className={checked.includes(id) ? "is-checked" : ""}><input type="checkbox" checked={checked.includes(id)} onChange={() => toggle(id)} /><span className="custom-checkbox" aria-hidden="true">{checked.includes(id) && <Check size={13} />}</span><span>{label}</span></label></li>)}</ul>{storageKey && <p className="checklist-privacy">{storageError ? "Браузер не разрешил сохранить отметки." : "Отметки сохраняются на этом устройстве."}</p>}</div>;
}
export function SectionLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const url = new URL(window.location.href); url.hash = id;
    try { await navigator.clipboard.writeText(url.href); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { window.prompt("Ссылка на этот раздел", url.href); }
  }
  return <button className="section-copy" aria-label={copied ? "Ссылка скопирована" : "Скопировать ссылку на раздел"} title={copied ? "Скопировано" : "Ссылка на раздел"} onClick={copy}>{copied ? <Check size={15} /> : <Link2 size={15} />}</button>;
}
