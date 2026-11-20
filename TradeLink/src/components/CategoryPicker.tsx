import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import "./category-picker.css";

export type PickerOption = { id: string; name: string; group?: string };

/** "Other ..." categories always come last. */
const isOther = (n: string) => /^other\b/i.test(n.trim());
export const sortCategories = <T extends { name: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => Number(isOther(a.name)) - Number(isOther(b.name)) || 0);

/** Searchable single-choice list used wherever a category is chosen (supplier products, admin products).
 *  Type to filter, arrow keys + Enter to choose, Esc to close. The list opens inline so it is never clipped inside a dialog. */
export default function CategoryPicker({ options, value, onChange, placeholder = "Choose a category", searchLabel = "Search categories", disabled = false, required = false, emptyText = "No category matches." }: {
  options: PickerOption[]; value: string; onChange: (id: string) => void; placeholder?: string; searchLabel?: string; disabled?: boolean; required?: boolean; emptyText?: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), listRef = useRef<HTMLUListElement>(null);
  const cur = options.find(o => o.id === value);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return n ? options.filter(o => `${o.name} ${o.group ?? ""}`.toLowerCase().includes(n)) : options;
  }, [options, q]);
  useEffect(() => { setHi(0); }, [q, open]);
  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  useEffect(() => { listRef.current?.children[hi]?.scrollIntoView?.({ block: "nearest" }); }, [hi]);
  const choose = (id: string) => { onChange(id); setOpen(false); setQ(""); };
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHi(h => Math.min(h + 1, shown.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (shown[hi]) choose(shown[hi].id); }
    else if (e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };
  return (
    <div className={`cp${open ? " open" : ""}`} ref={box}>
      <button type="button" className="cp-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${uid}-list`} onClick={() => setOpen(o => !o)}>
        <span className={cur ? "" : "ph"}>{cur ? cur.name : placeholder}</span><ChevronDown size={18} aria-hidden="true" />
      </button>
      {/* Keeps native form validation working for `required`. */}
      {required && <input className="cp-req" tabIndex={-1} aria-hidden="true" required value={value} onChange={() => {}} />}
      {open && (
        <div className="cp-pop">
          <div className="cp-search"><Search size={16} aria-hidden="true" /><input ref={input} value={q} onChange={e => setQ(e.target.value)} onKeyDown={key} placeholder={searchLabel} aria-label={searchLabel} role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-activedescendant={shown[hi] ? `${uid}-o${hi}` : undefined} autoComplete="off" /></div>
          <ul id={`${uid}-list`} role="listbox" ref={listRef}>
            {shown.map((o, i) => (
              <li key={o.id} id={`${uid}-o${i}`} role="option" aria-selected={o.id === value} className={`${i === hi ? "hi" : ""}${o.id === value ? " on" : ""}`} onMouseEnter={() => setHi(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(o.id)}>
                <span>{o.name}{o.group && <small>{o.group}</small>}</span>{o.id === value && <Check size={16} aria-hidden="true" />}
              </li>
            ))}
            {shown.length === 0 && <li className="cp-empty" role="presentation">{emptyText}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
