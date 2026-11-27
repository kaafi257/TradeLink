import { useState } from "react";
import { MapPin, Phone, Store } from "lucide-react";
import { logoUrl } from "../../pages/supplier/files";
import { usePlaces, type SupplierPlace } from "./ops";
import SupplierLocationModal from "./SupplierLocationModal";
import "./ops.css";

/** Every supplier with their saved shop location. Only the owner or a manager can set or change it. */
export default function SuppliersTab() {
  const pl = usePlaces(60_000);
  const [edit, setEdit] = useState<SupplierPlace | null>(null);
  return (
    <div className="drs">
      <p className="ops-note" style={{ margin: 0 }}>A supplier can save their shop location once, from their own profile. After that only you can change it here.</p>
      {!pl.loading && pl.suppliers.length === 0 && <p className="ops-empty">No suppliers yet.</p>}
      {pl.suppliers.map(s => (
        <article className="drs-card" key={s.id}>
          <span className="drs-av">{logoUrl(s.logo) ? <img src={logoUrl(s.logo)!} alt="" /> : <Store size={22} />}</span>
          <div className="drs-main">
            <b>{s.name}</b>
            <small>{s.businessType ?? "Supplier"} · {s.status}{s.openJobs ? ` · ${s.openJobs} open deliveries` : ""}</small>
            <small>{s.phone ? <><Phone size={13} /> {s.phone}</> : "No phone"}{s.address ? ` · ${s.address}` : ""}</small>
            <small><MapPin size={13} /> {s.lat != null ? `Saved ${s.capturedAt ? new Date(s.capturedAt).toLocaleDateString() : ""}${s.accuracy != null ? ` · accuracy about ${Math.round(s.accuracy)} m` : ""}` : "No shop location yet"}</small>
          </div>
          <div className="drs-act">
            <span className={`drs-chip ${s.lat != null ? "ok" : ""}`}>{s.lat != null ? "Location saved" : "Missing"}</span>
            <button type="button" className="drs-btn" onClick={() => setEdit(s)}><MapPin size={16} /> {s.lat != null ? "Change" : "Set location"}</button>
          </div>
        </article>
      ))}
      {edit && <SupplierLocationModal place={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); pl.reload(); }} />}
    </div>
  );
}
