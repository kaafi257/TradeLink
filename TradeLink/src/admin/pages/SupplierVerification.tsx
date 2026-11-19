import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Building2, ClipboardCheck, ExternalLink, FileText, RefreshCw } from "lucide-react";
import { PageHeading } from "../../components/ui";
import { errorText, requireSupabase, type Supplier, type SupplierStatus } from "../../lib/supabase";
import { documentLink, logoUrl } from "../../pages/supplier/files";
import { BUSINESS_TYPES } from "../../pages/supplier/Register";
import { useAdmin } from "../AdminData";

type Application = Supplier;
const label: Record<SupplierStatus,string> = {pending:"Pending",approved:"Approved",rejected:"Needs changes",suspended:"Suspended"};
export default function SupplierVerification() {
  const {notify,industries}=useAdmin();
  const [rows,setRows]=useState<Application[]>([]);
  const [loading,setLoading]=useState(true);
  const [selected,setSelected]=useState<Application|null>(null);
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const load=useCallback(async()=>{
    setLoading(true);
    const {data,error}=await requireSupabase().from("suppliers").select("*").not("profile_id","is",null).order("created_at",{ascending:false});
    if(error)notify(errorText(error,"Could not load supplier applications"));else setRows((data??[]) as Application[]);
    setLoading(false);
  },[notify]);
  useEffect(()=>{void load();},[load]);
  const review=async(action:"approve"|"reject"|"suspend"|"reactivate")=>{
    if(!selected)return;
    if(["reject","suspend"].includes(action)&&note.trim().length<5){notify("Add a reason of at least 5 characters.");return;}
    setBusy(true);
    try{
      const {error}=await requireSupabase().rpc("review_supplier",{p_id:selected.id,p_action:action,p_note:note.trim()||null});
      if(error)throw error;
      notify(action==="approve"?"Supplier approved.":action==="reject"?"Application returned with a note.":action==="suspend"?"Supplier suspended.":"Supplier reactivated.");
      setSelected(null);setNote("");await load();
    }catch(e){notify(errorText(e,"Could not update supplier verification"));}finally{setBusy(false);}
  };
  const open=async(path:string)=>{try{window.open(await documentLink(path),"_blank","noopener,noreferrer");}catch(e){notify((e as Error).message);}};
  const pending=rows.filter(r=>(r.status??"pending")==="pending").length;
  return <>
    <PageHeading title="Supplier Verification" sub="Review registered supplier applications, documents and approval status." action={<button className="btn outline" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button>}/>
    <div className="summary-strip">
      <div className="metric blue"><span className="metric-ico"><ClipboardCheck/></span><b>{pending}</b><small>Pending review</small></div>
      <div className="metric mint"><span className="metric-ico"><BadgeCheck/></span><b>{rows.filter(r=>r.status==="approved").length}</b><small>Approved</small></div>
      <div className="metric red"><span className="metric-ico"><Building2/></span><b>{rows.filter(r=>r.status==="suspended").length}</b><small>Suspended</small></div>
    </div>
    <div className="table-panel"><div className="table-scroll"><table className="rt rt-m">
      <thead><tr><th>Supplier</th><th>Business type</th><th>Industry</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead>
      <tbody>{rows.map(r=><tr key={r.id}><td><b>{r.name}</b><small>{r.owner_name||"—"} · {r.email||"No email"}</small></td><td>{BUSINESS_TYPES.find(t=>t.id===r.business_type)?.label||r.business_type||"—"}</td><td>{industries.find(i=>i.id===r.industry_id)?.name||"—"}</td><td>{new Date(r.created_at).toLocaleDateString()}</td><td><span className={"status "+((r.status==="approved")?"good":(r.status==="rejected"||r.status==="suspended")?"bad":"warn")}>{label[r.status??"pending"]}</span></td><td data-actions><button className="btn outline" onClick={()=>{setSelected(r);setNote("");}}>Review</button></td></tr>)}
      {!rows.length&&<tr><td colSpan={6}><div className="empty-state"><BadgeCheck/><p>{loading?"Loading supplier applications…":"No registered supplier applications."}</p></div></td></tr>}</tbody>
    </table></div></div>
    {selected&&<div className="modal-backdrop"><div className="modal wide-modal" role="dialog" aria-modal="true" aria-label={"Review "+selected.name}>
      <button className="modal-x" onClick={()=>setSelected(null)} aria-label="Close">×</button>
      <small className="kicker">SUPPLIER VERIFICATION</small><h2>{selected.name}</h2>
      <div className="review-grid">
        <div className="review-block"><h4>Business details</h4><div className="review-logo">{logoUrl(selected.logo_path)?<img src={logoUrl(selected.logo_path)!} alt="Supplier logo"/>:<Building2/>}</div>
          <dl><dt>Owner</dt><dd>{selected.owner_name||"—"}</dd><dt>Type</dt><dd>{BUSINESS_TYPES.find(t=>t.id===selected.business_type)?.label||selected.business_type||"—"}</dd><dt>Industry</dt><dd>{industries.find(i=>i.id===selected.industry_id)?.name||"—"}</dd><dt>Location</dt><dd>{[selected.location,selected.address].filter(Boolean).join(", ")||"—"}</dd><dt>Phone</dt><dd>{selected.phone||"—"}</dd><dt>Email</dt><dd>{selected.email||"—"}</dd></dl>
        </div>
        <div className="review-block"><h4>Verification documents</h4>
          {!selected.documents?.length?<p className="muted-text">No documents uploaded.</p>:<ul className="review-docs">{selected.documents.map(doc=><li key={doc.path}><FileText size={15}/><span>{doc.name}</span><button className="icon-action" aria-label={"Open "+doc.name} onClick={()=>void open(doc.path)}><ExternalLink size={15}/></button></li>)}</ul>}
          {selected.status_note&&<p className="review-note"><b>Previous review note</b>{selected.status_note}</p>}
        </div>
      </div>
      <label className="full">Review note<textarea rows={3} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="Required when rejecting or suspending an application."/></label>
      <div className="review-buttons">
        {["pending","rejected"].includes(selected.status??"pending")&&<button className="btn green" disabled={busy} onClick={()=>void review("approve")}>Approve</button>}
        {selected.status==="pending"&&<button className="btn danger" disabled={busy} onClick={()=>void review("reject")}>Reject with note</button>}
        {selected.status==="approved"&&<button className="btn danger" disabled={busy} onClick={()=>void review("suspend")}>Suspend</button>}
        {selected.status==="suspended"&&<button className="btn green" disabled={busy} onClick={()=>void review("reactivate")}>Reactivate</button>}
        <button className="btn outline" onClick={()=>setSelected(null)}>Close</button>
      </div>
    </div></div>}
  </>;
}
