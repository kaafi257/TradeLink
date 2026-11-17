import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ImagePlus, Plus, X } from "lucide-react";
import { requireSupabase, type ProductImage, type ProductOption } from "../lib/supabase";
import { IMAGE_ACCEPT, checkImage, removeProductImage, uploadProductImage } from "../lib/upload";

type Photo = { key: string; id?: string; url: string; file?: File };
type Color = { label: string; hex: string };

/**
 * Extra photos, sizes and colours for a product (tables from migration 0006).
 * `ready` stays false when those tables do not exist yet, so the normal product form keeps working before the migration.
 */
export function useFashionEditor(productId: string | null, notify: (m: string) => void) {
  const [ready, setReady] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [sizes, setSizes] = useState<string[]>([]);
  const [colors, setColors] = useState<Color[]>([]);
  const original = useRef<Photo[]>([]);

  useEffect(() => {
    let live = true;
    (async () => {
      const s = requireSupabase();
      const probe = await s.from("product_options").select("id").limit(1);
      if (!live || probe.error) return;
      setReady(true);
      if (!productId) return;
      const [im, op] = await Promise.all([
        s.from("product_images").select("*").eq("product_id", productId).order("sort_order"),
        s.from("product_options").select("*").eq("product_id", productId).order("sort_order"),
      ]);
      if (!live) return;
      const ph = ((im.data ?? []) as ProductImage[]).map(r => ({ key: r.id, id: r.id, url: r.url }));
      original.current = ph; setPhotos(ph);
      const opts = (op.data ?? []) as ProductOption[];
      setSizes(opts.filter(o => o.kind === "size").map(o => o.label));
      setColors(opts.filter(o => o.kind === "color").map(o => ({ label: o.label, hex: o.color_hex || "#111111" })));
    })();
    return () => { live = false; };
  }, [productId]);

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const next: Photo[] = [];
    for (const f of Array.from(files)) {
      const problem = checkImage(f);
      if (problem) { notify(problem); continue; }
      next.push({ key: crypto.randomUUID(), url: URL.createObjectURL(f), file: f });
    }
    setPhotos(p => [...p, ...next].slice(0, 8));
  };
  const removePhoto = (key: string) => setPhotos(p => p.filter(x => x.key !== key));

  /** Saves photos and options for a product that already exists. Throws on failure. */
  const save = async (id: string) => {
    if (!ready) return;
    const s = requireSupabase();
    const keepIds = new Set(photos.filter(p => p.id).map(p => p.id!));
    const gone = original.current.filter(p => p.id && !keepIds.has(p.id));
    if (gone.length) {
      const { error } = await s.from("product_images").delete().in("id", gone.map(g => g.id!));
      if (error) throw error;
      gone.forEach(g => void removeProductImage(g.url));
    }
    for (const [i, p] of photos.entries()) {
      if (p.id) { await s.from("product_images").update({ sort_order: (i + 1) * 10 }).eq("id", p.id); continue; }
      const url = await uploadProductImage(p.file!);
      const { error } = await s.from("product_images").insert({ product_id: id, url, sort_order: (i + 1) * 10 });
      if (error) { void removeProductImage(url); throw error; }
    }
    // Options have nothing depending on them, so they are simply replaced.
    const del = await s.from("product_options").delete().eq("product_id", id);
    if (del.error) throw del.error;
    const rows = [
      ...sizes.map((label, i) => ({ product_id: id, kind: "size", label, color_hex: null, sort_order: (i + 1) * 10 })),
      ...colors.map((c, i) => ({ product_id: id, kind: "color", label: c.label, color_hex: c.hex, sort_order: (i + 1) * 10 })),
    ];
    if (rows.length) { const ins = await s.from("product_options").insert(rows); if (ins.error) throw ins.error; }
  };

  return { ready, photos, addPhotos, removePhoto, sizes, setSizes, colors, setColors, save };
}

export function FashionFields({ ed }: { ed: ReturnType<typeof useFashionEditor> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState("");
  const [cLabel, setCLabel] = useState("");
  const [cHex, setCHex] = useState("#111111");
  if (!ed.ready) return null;

  const addSizes = () => {
    const list = size.split(",").map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    ed.setSizes(cur => [...cur, ...list.filter(l => !cur.some(c => c.toLowerCase() === l.toLowerCase()))].slice(0, 20));
    setSize("");
  };
  const addColor = () => {
    const label = cLabel.trim();
    if (!label) return;
    ed.setColors(cur => (cur.some(c => c.label.toLowerCase() === label.toLowerCase()) ? cur : [...cur, { label, hex: cHex }].slice(0, 20)));
    setCLabel("");
  };
  const enter = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); fn(); } };
  const pick = (e: ChangeEvent<HTMLInputElement>) => { ed.addPhotos(e.target.files); e.target.value = ""; };

  return (
    <>
      <div className="full image-field">
        <span className="image-label">More photos (shown in the gallery, up to 8)</span>
        <div className="gallery-edit">
          {ed.photos.map(p => (
            <span className="gallery-thumb" key={p.key}>
              <img src={p.url} alt="" />
              <button type="button" aria-label="Remove photo" onClick={() => ed.removePhoto(p.key)}><X size={14} /></button>
            </span>
          ))}
          {ed.photos.length < 8 && <button type="button" className="gallery-add" onClick={() => fileRef.current?.click()}><ImagePlus /><small>Add photos</small></button>}
          <input ref={fileRef} type="file" accept={IMAGE_ACCEPT} multiple onChange={pick} hidden />
        </div>
        <small>The first extra photo appears when customers hover the product card.</small>
      </div>
      <div className="full opt-field">
        <span className="image-label">Sizes</span>
        <div className="chip-edit">
          {ed.sizes.map(s => <span className="chip" key={s}>{s}<button type="button" aria-label={`Remove size ${s}`} onClick={() => ed.setSizes(cur => cur.filter(x => x !== s))}><X size={12} /></button></span>)}
        </div>
        <div className="opt-add">
          <input value={size} onChange={e => setSize(e.target.value)} onKeyDown={enter(addSizes)} maxLength={60} placeholder="e.g. S, M, L, XL or 40, 41, 42" aria-label="Add sizes" />
          <button type="button" className="btn outline" onClick={addSizes}><Plus size={15} /> Add</button>
        </div>
      </div>
      <div className="full opt-field">
        <span className="image-label">Colours</span>
        <div className="chip-edit">
          {ed.colors.map(c => <span className="chip" key={c.label}><i style={{ background: c.hex }} />{c.label}<button type="button" aria-label={`Remove colour ${c.label}`} onClick={() => ed.setColors(cur => cur.filter(x => x.label !== c.label))}><X size={12} /></button></span>)}
        </div>
        <div className="opt-add">
          <input type="color" value={cHex} onChange={e => setCHex(e.target.value)} aria-label="Colour swatch" className="opt-color" />
          <input value={cLabel} onChange={e => setCLabel(e.target.value)} onKeyDown={enter(addColor)} maxLength={30} placeholder="Colour name, e.g. Navy" aria-label="Colour name" />
          <button type="button" className="btn outline" onClick={addColor}><Plus size={15} /> Add</button>
        </div>
      </div>
    </>
  );
}
