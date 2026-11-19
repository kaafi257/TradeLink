import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BadgeCheck, Banknote, ChartNoAxesCombined, Check, CircleAlert, Eye, Megaphone, MessageSquare, RefreshCw, ShieldCheck, Star, Store, Wallet, X } from "lucide-react";
import { DataTable, Empty, PageHeading, SummaryStrip } from "../../components/ui";
import { errorText, requireSupabase } from "../../lib/supabase";
import { useAdmin } from "../AdminData";

type Row = Record<string, any>;
const db = () => requireSupabase();
const money = (v: unknown) => "ETB " + Number(v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (v?: string | null) => v ? new Date(v).toLocaleDateString() : "—";
const stamp = (v?: string | null) => v ? new Date(v).toLocaleString() : "—";
const tone = (s: string) => ["paid","verified","approved","published","resolved","received","active"].includes(s) ? "good" : ["failed","rejected","hidden","cancelled","suspended"].includes(s) ? "bad" : ["open","pending","queued","requested","submitted","under_review","investigating","processing"].includes(s) ? "warn" : "muted";
function Status({ value }: { value?: string }) { const v = value || "unknown"; return <span className={"status " + tone(v)}>{v.replaceAll("_"," ")}</span>; }
function PageError({ message }: { message: string }) { return <div className="table-panel"><div className="empty-state"><CircleAlert /><p>{message}</p></div></div>; }
function useLoad<T extends Row>(table: string, order = "created_at") {
  const { notify } = useAdmin();
  const [rows,setRows] = useState<T[]>([]);
  const [loading,setLoading] = useState(true);
  const [failed,setFailed] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    const { data,error } = await db().from(table).select("*").order(order,{ascending:false}).limit(500);
    if(error){setFailed(true);notify(errorText(error,"Could not load " + table));}
    else {setFailed(false);setRows((data ?? []) as T[]);}
    setLoading(false);
  },[table,order,notify]);
  useEffect(()=>{void load();},[load]);
  return {rows,setRows,loading,failed,load};
}
function ActionButton({ children, onClick, disabled=false }: { children: ReactNode; onClick:()=>void; disabled?:boolean }) {
  return <button type="button" className="btn outline" disabled={disabled} onClick={onClick}>{children}</button>;
}

export function PaymentsPage() {
  const { notify, profile } = useAdmin();
  const [tab,setTab] = useState<"payments"|"payouts"|"providers">("payments");
  const payments = useLoad<Row>("marketplace_payment_records");
  const payouts = useLoad<Row>("marketplace_payouts");
  const providers = useLoad<Row>("marketplace_payment_providers","display_name");
  const [suppliers,setSuppliers] = useState<Row[]>([]);
  const [showCreate,setShowCreate] = useState(false);
  const [busy,setBusy] = useState(false);
  useEffect(()=>{db().from("suppliers").select("id,name").order("name").then(({data,error})=>{if(error)notify(errorText(error,"Could not load suppliers"));else setSuppliers(data??[]);});},[notify]);
  const refresh = async()=>{await Promise.all([payments.load(),payouts.load(),providers.load()]);};
  const createPayout = async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault(); const f=new FormData(e.currentTarget); setBusy(true);
    try {
      const {error}=await db().from("marketplace_payouts").insert({supplier_id:String(f.get("supplier_id")),amount:Number(f.get("amount")),provider_code:String(f.get("provider_code")),destination_reference:String(f.get("destination_reference")||"").trim()||null,status:"queued"});
      if(error)throw error; notify("Payout added to the queue.");setShowCreate(false);await payouts.load();
    } catch(err){notify(errorText(err,"Could not create payout"));} finally{setBusy(false);}
  };
  const advancePayout = async(r:Row,next:string)=>{
    if(!window.confirm("Move payout to " + next.replaceAll("_"," ") + "?"))return;
    const patch:Row={status:next};
    if(next==="approved"){patch.approved_by=profile.id;patch.approved_at=new Date().toISOString();}
    const {error}=await db().from("marketplace_payouts").update(patch).eq("id",r.id);
    if(error)notify(errorText(error,"Could not update payout"));else{notify("Payout updated.");await payouts.load();}
  };
  const payTotal=payments.rows.reduce((n,r)=>n+Number(r.amount||0),0);
  const queued=payouts.rows.filter(r=>["queued","approved","processing"].includes(r.status)).reduce((n,r)=>n+Number(r.amount||0),0);
  return <>
    <PageHeading title="Payments & Payouts" sub="Track payment records and manage supplier payout queues." action={<button className="btn green" onClick={()=>setShowCreate(v=>!v)}><Wallet size={16}/> New payout</button>}/>
    <SummaryStrip items={[
      {icon:<Banknote/>,tone:"blue",value:money(payTotal),label:"Recorded payments"},
      {icon:<Wallet/>,tone:"mint",value:money(queued),label:"Payout queue"},
      {icon:<RefreshCw/>,tone:"red",value:payments.rows.filter(r=>["pending","submitted"].includes(r.status)).length,label:"Unverified"},
    ]}/>
    <div className="status-tabs" role="tablist">
      {(["payments","payouts","providers"] as const).map(x=><button key={x} role="tab" aria-selected={tab===x} className={tab===x?"on":""} onClick={()=>setTab(x)}>{x==="payments"?"Payments":x==="payouts"?"Supplier payouts":"Payment providers"}</button>)}
      <button style={{marginLeft:"auto"}} onClick={()=>void refresh()}><RefreshCw size={14}/> Refresh</button>
    </div>
    {showCreate && <div className="table-panel" style={{padding:18,marginBottom:14}}>
      <h3 style={{marginTop:0}}>Queue a supplier payout</h3>
      <form className="form-grid" onSubmit={createPayout}>
        <label>Supplier<select name="supplier_id" required defaultValue=""><option value="" disabled>Select supplier</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Amount (ETB)<input name="amount" type="number" min="0.01" step="0.01" required/></label>
        <label>Payment rail<select name="provider_code" defaultValue="bank_transfer"><option value="bank_transfer">Bank transfer</option><option value="telebirr">Telebirr</option><option value="cbe">CBE</option><option value="ebirr">eBirr</option></select></label>
        <label>Destination reference<input name="destination_reference" maxLength={160} placeholder="Supplier payout account reference"/></label>
        <button className="btn green full" disabled={busy||!suppliers.length}>{busy?"Saving…":"Add to payout queue"}</button>
      </form>
    </div>}
    {tab==="payments" && <DataTable headers={["Date","Order","Supplier","Provider","Reference","Amount","Status"]} empty={payments.loading?"Loading payments…":"No payment records yet."} isEmpty={!payments.rows.length}>
      {payments.rows.map(r=><tr key={r.id}><td>{stamp(r.created_at)}</td><td>{r.order_id||"—"}</td><td>{r.supplier_id||"—"}</td><td>{r.provider_code}</td><td>{r.transaction_reference||"—"}</td><td>{money(r.amount)}</td><td><Status value={r.status}/></td></tr>)}
    </DataTable>}
    {tab==="payouts" && <DataTable headers={["Created","Supplier","Amount","Rail","Destination","Status","Next action"]} empty={payouts.loading?"Loading payouts…":"No supplier payouts in the queue."} isEmpty={!payouts.rows.length}>
      {payouts.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{suppliers.find(s=>s.id===r.supplier_id)?.name||r.supplier_id}</td><td>{money(r.amount)}</td><td>{r.provider_code}</td><td>{r.destination_reference||"—"}</td><td><Status value={r.status}/></td><td data-actions>{r.status==="queued"?<ActionButton onClick={()=>void advancePayout(r,"approved")}>Approve</ActionButton>:r.status==="approved"?<ActionButton onClick={()=>void advancePayout(r,"processing")}>Processing</ActionButton>:r.status==="processing"?<ActionButton onClick={()=>void advancePayout(r,"failed")}>Mark failed</ActionButton>:<span>—</span>}</td></tr>)}
    </DataTable>}
    {tab==="providers" && <DataTable headers={["Provider","Enabled","Integration","Credentials","Last tested"]} empty={providers.loading?"Loading providers…":"No payment providers configured."} isEmpty={!providers.rows.length}>
      {providers.rows.map(r=><tr key={r.id}><td><b>{r.display_name}</b></td><td><Status value={r.enabled?"enabled":"disabled"}/></td><td><Status value={r.integration_status}/></td><td>{r.credentials_configured?"Configured":"Not configured"}</td><td>{stamp(r.last_tested_at)}</td></tr>)}
    </DataTable>}
    <p className="inline-note"><ShieldCheck size={15}/> Provider credentials are never displayed. Payment verification and payout completion must come from trusted provider confirmation.</p>
  </>;
}

export function CommissionsPage() {
  const {categories,notify}=useAdmin();
  const commissions=useLoad<Row>("marketplace_category_commissions","updated_at");
  const ledger=useLoad<Row>("sale_commissions");
  const [editing,setEditing]=useState<Row|null>(null);
  const [busy,setBusy]=useState(false);
  const save=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);const category_id=String(f.get("category_id"));
    const values={commission_type:String(f.get("commission_type")),commission_value:Number(f.get("commission_value")),active:f.get("active")==="on"};
    setBusy(true);
    try{
      const old=commissions.rows.find(r=>r.category_id===category_id);
      const q=old?db().from("marketplace_category_commissions").update(values).eq("id",old.id):db().from("marketplace_category_commissions").insert({category_id,...values});
      const {error}=await q;if(error)throw error;notify("Category commission saved.");setEditing(null);await commissions.load();
    }catch(err){notify(errorText(err,"Could not save commission"));}finally{setBusy(false);}
  };
  return <>
    <PageHeading title="Commissions" sub="Set category-based commission rules and review the supplier commission ledger."/>
    <div className="table-panel" style={{padding:18,marginBottom:16}}>
      <h3 style={{marginTop:0}}>{editing?"Edit category commission":"Add category commission"}</h3>
      <form className="form-grid" onSubmit={save}>
        <label>Category<select name="category_id" required defaultValue={editing?.category_id||""} key={editing?.id||"new"}><option value="" disabled>Select category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Commission type<select name="commission_type" defaultValue={editing?.commission_type||"percentage"}><option value="percentage">Percentage (%)</option><option value="fixed">Fixed amount (ETB)</option></select></label>
        <label>Value<input name="commission_value" type="number" min="0" step="0.01" required defaultValue={editing?.commission_value??""}/></label>
        <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active??true}/> Active</label>
        <button className="btn green" disabled={busy}>{busy?"Saving…":"Save commission"}</button>
        {editing&&<button type="button" className="btn outline" onClick={()=>setEditing(null)}>Cancel</button>}
      </form>
    </div>
    <DataTable headers={["Category","Rule","Value","Status","Action"]} empty={commissions.loading?"Loading commission rules…":"No category commission rules configured."} isEmpty={!commissions.rows.length}>
      {commissions.rows.map(r=><tr key={r.id}><td>{categories.find(c=>c.id===r.category_id)?.name||r.category_id}</td><td>{r.commission_type}</td><td>{r.commission_type==="percentage"?r.commission_value+"%":money(r.commission_value)}</td><td><Status value={r.active?"active":"inactive"}/></td><td data-actions><ActionButton onClick={()=>setEditing(r)}>Edit</ActionButton></td></tr>)}
    </DataTable>
    <h3 style={{margin:"24px 0 10px"}}>Recorded commission ledger</h3>
    <DataTable headers={["Date","Product","Quantity","Supplier amount","Commission","Supplier earning"]} empty={ledger.loading?"Loading ledger…":"No commission entries recorded yet."} isEmpty={!ledger.rows.length}>
      {ledger.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.product_name}</td><td>{r.quantity}</td><td>{money(r.supplier_amount)}</td><td>{money(r.commission)}</td><td>{money(r.supplier_earning)}</td></tr>)}
    </DataTable>
  </>;
}

export function ReturnsDisputesPage() {
  const {notify}=useAdmin();
  const returns=useLoad<Row>("marketplace_returns");
  const disputes=useLoad<Row>("marketplace_disputes");
  const [tab,setTab]=useState<"returns"|"disputes">("returns");
  const [notes,setNotes]=useState<Record<string,string>>({});
  const update=async(table:string,r:Row,status:string,note:string)=>{
    const patch:Row=table==="marketplace_returns"?{status,resolution_note:note||null,reviewed_by:profile.id,reviewed_at:new Date().toISOString()}:{status,resolution:note||null,resolved_at:["resolved","closed"].includes(status)?new Date().toISOString():null};
    const {error}=await db().from(table).update(patch).eq("id",r.id);
    if(error)notify(errorText(error,"Could not update case"));else{notify("Case updated.");await (table==="marketplace_returns"?returns.load():disputes.load());}
  };
  return <>
    <PageHeading title="Returns & Disputes" sub="Review customer return requests and resolve marketplace disputes."/>
    <div className="status-tabs">{(["returns","disputes"] as const).map(t=><button key={t} className={tab===t?"on":""} onClick={()=>setTab(t)}>{t==="returns"?"Returns":"Disputes"}</button>)}</div>
    {tab==="returns"?<DataTable headers={["Requested","Order","Reason","Details","Status","Resolution note","Update"]} empty={returns.loading?"Loading returns…":"No return requests."} isEmpty={!returns.rows.length}>
      {returns.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.order_id}</td><td>{r.reason}</td><td>{r.details||"—"}</td><td><Status value={r.status}/></td><td><input aria-label="Return resolution note" value={notes[r.id]??r.resolution_note??""} onChange={e=>setNotes(v=>({...v,[r.id]:e.target.value}))}/></td><td data-actions><select aria-label="Return status" defaultValue={r.status} onChange={e=>void update("marketplace_returns",r,e.target.value,notes[r.id]??r.resolution_note??"")}><option value="requested">Requested</option><option value="under_review">Under review</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="received">Received</option><option value="closed">Closed</option></select></td></tr>)}
    </DataTable>:<DataTable headers={["Opened","Order","Subject","Description","Status","Resolution","Update"]} empty={disputes.loading?"Loading disputes…":"No disputes."} isEmpty={!disputes.rows.length}>
      {disputes.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.order_id}</td><td>{r.subject}</td><td>{r.description}</td><td><Status value={r.status}/></td><td><input aria-label="Dispute resolution" value={notes[r.id]??r.resolution??""} onChange={e=>setNotes(v=>({...v,[r.id]:e.target.value}))}/></td><td data-actions><select aria-label="Dispute status" defaultValue={r.status} onChange={e=>void update("marketplace_disputes",r,e.target.value,notes[r.id]??r.resolution??"")}><option value="open">Open</option><option value="investigating">Investigating</option><option value="awaiting_customer">Awaiting customer</option><option value="awaiting_supplier">Awaiting supplier</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></td></tr>)}
    </DataTable>}
  </>;
}

export function MarketingPage() {
  const {notify}=useAdmin();
  const promotions=useLoad<Row>("marketplace_promotions");
  const [editing,setEditing]=useState<Row|null>(null);
  const [busy,setBusy]=useState(false);
  const save=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);
    const values={name:String(f.get("name")).trim(),code:String(f.get("code")||"").trim().toUpperCase()||null,discount_type:String(f.get("discount_type")),discount_value:Number(f.get("discount_value")),starts_at:new Date(String(f.get("starts_at"))).toISOString(),ends_at:new Date(String(f.get("ends_at"))).toISOString(),usage_limit:f.get("usage_limit")?Number(f.get("usage_limit")):null,active:f.get("active")==="on"};
    if(new Date(values.ends_at)<=new Date(values.starts_at)){notify("End date must be after start date.");return;}
    setBusy(true);
    try{const q=editing?db().from("marketplace_promotions").update(values).eq("id",editing.id):db().from("marketplace_promotions").insert(values);const {error}=await q;if(error)throw error;notify("Promotion saved.");setEditing(null);await promotions.load();}
    catch(err){notify(errorText(err,"Could not save promotion"));}finally{setBusy(false);}
  };
  const toggle=async(r:Row)=>{const {error}=await db().from("marketplace_promotions").update({active:!r.active}).eq("id",r.id);if(error)notify(errorText(error,"Could not update promotion"));else await promotions.load();};
  return <>
    <PageHeading title="Marketing & Promotions" sub="Create and manage discount campaigns stored in the marketplace."/>
    <div className="table-panel" style={{padding:18,marginBottom:16}}>
      <h3 style={{marginTop:0}}>{editing?"Edit promotion":"Create promotion"}</h3>
      <form className="form-grid" onSubmit={save}>
        <label>Campaign name<input name="name" required maxLength={100} defaultValue={editing?.name||""} key={editing?.id||"new"}/></label>
        <label>Promo code<input name="code" maxLength={32} defaultValue={editing?.code||""}/></label>
        <label>Discount type<select name="discount_type" defaultValue={editing?.discount_type||"percentage"}><option value="percentage">Percentage</option><option value="fixed">Fixed ETB</option></select></label>
        <label>Discount value<input name="discount_value" type="number" min="0.01" step="0.01" required defaultValue={editing?.discount_value??""}/></label>
        <label>Starts<input name="starts_at" type="datetime-local" required defaultValue={editing?.starts_at?new Date(editing.starts_at).toISOString().slice(0,16):""}/></label>
        <label>Ends<input name="ends_at" type="datetime-local" required defaultValue={editing?.ends_at?new Date(editing.ends_at).toISOString().slice(0,16):""}/></label>
        <label>Usage limit<input name="usage_limit" type="number" min="1" step="1" defaultValue={editing?.usage_limit??""}/></label>
        <label className="checkbox-label"><input name="active" type="checkbox" defaultChecked={editing?.active??false}/> Active</label>
        <button className="btn green" disabled={busy}>{busy?"Saving…":"Save promotion"}</button>{editing&&<button type="button" className="btn outline" onClick={()=>setEditing(null)}>Cancel</button>}
      </form>
    </div>
    <DataTable headers={["Campaign","Code","Discount","Period","Usage","Status","Actions"]} empty={promotions.loading?"Loading promotions…":"No promotions created."} isEmpty={!promotions.rows.length}>
      {promotions.rows.map(r=><tr key={r.id}><td>{r.name}</td><td>{r.code||"—"}</td><td>{r.discount_type==="percentage"?r.discount_value+"%":money(r.discount_value)}</td><td>{date(r.starts_at)} – {date(r.ends_at)}</td><td>{r.usage_count}{r.usage_limit?" / "+r.usage_limit:""}</td><td><Status value={r.active?"active":"inactive"}/></td><td data-actions><ActionButton onClick={()=>setEditing(r)}>Edit</ActionButton>{" "}<ActionButton onClick={()=>void toggle(r)}>{r.active?"Pause":"Activate"}</ActionButton></td></tr>)}
    </DataTable>
    <p className="inline-note"><Megaphone size={15}/> Campaign records are managed here. Checkout applies discounts only when its existing promotion-validation workflow supports them.</p>
  </>;
}

export function ReviewsPage() {
  const {notify}=useAdmin();
  const reviews=useLoad<Row>("marketplace_reviews");
  const moderate=async(r:Row,status:string)=>{
    const {error}=await db().from("marketplace_reviews").update({status,moderated_by:profile.id,moderated_at:new Date().toISOString()}).eq("id",r.id);
    if(error)notify(errorText(error,"Could not moderate review"));else{notify("Review " + status + ".");await reviews.load();}
  };
  const avg=reviews.rows.length?reviews.rows.reduce((n,r)=>n+Number(r.rating),0)/reviews.rows.length:0;
  return <>
    <PageHeading title="Reviews & Ratings" sub="Moderate customer feedback before it appears on marketplace listings."/>
    <SummaryStrip items={[
      {icon:<Star/>,tone:"blue",value:avg.toFixed(1),label:"Average rating"},
      {icon:<MessageSquare/>,tone:"mint",value:reviews.rows.length,label:"Total reviews"},
      {icon:<Eye/>,tone:"red",value:reviews.rows.filter(r=>r.status==="pending").length,label:"Awaiting review"},
    ]}/>
    <DataTable headers={["Date","Rating","Review","Product / supplier","Status","Moderation"]} empty={reviews.loading?"Loading reviews…":"No customer reviews yet."} isEmpty={!reviews.rows.length}>
      {reviews.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{"★".repeat(Number(r.rating))} ({r.rating}/5)</td><td><b>{r.title||"Customer review"}</b><small>{r.body}</small></td><td>{r.product_id||r.supplier_id||"—"}</td><td><Status value={r.status}/></td><td data-actions>{r.status!=="published"&&<ActionButton onClick={()=>void moderate(r,"published")}><Check size={14}/> Publish</ActionButton>}{" "}{r.status!=="hidden"&&<ActionButton onClick={()=>void moderate(r,"hidden")}><Eye size={14}/> Hide</ActionButton>}{" "}{r.status!=="rejected"&&<ActionButton onClick={()=>void moderate(r,"rejected")}><X size={14}/> Reject</ActionButton>}</td></tr>)}
    </DataTable>
  </>;
}

export function WebsiteManagementPage() {
  const {notify,industries,categories,products}=useAdmin();
  const [events,setEvents]=useState<Row[]>([]);
  const [loading,setLoading]=useState(true);
  const [failed,setFailed]=useState(false);
  const [period,setPeriod]=useState(30);
  const load=useCallback(async()=>{
    setLoading(true);const since=new Date(Date.now()-period*86400000).toISOString();
    const {data,error}=await db().from("site_events").select("id,kind,term,results,mode,created_at").gte("created_at",since).order("created_at",{ascending:false}).limit(500);
    if(error){setFailed(true);notify(errorText(error,"Could not load website activity"));}else{setFailed(false);setEvents(data??[]);}setLoading(false);
  },[period,notify]);
  useEffect(()=>{void load();},[load]);
  const searches=useMemo(()=>events.filter(e=>e.kind==="search"&&e.term).reduce((a,e)=>{a[e.term]=(a[e.term]||0)+1;return a;},{} as Record<string,number>),[events]);
  const topSearches=Object.entries(searches).sort((a,b)=>b[1]-a[1]).slice(0,8);
  return <>
    <PageHeading title="Website Management" sub="Monitor storefront activity and the catalogue currently published to customers."/>
    <div className="status-tabs"><button className={period===7?"on":""} onClick={()=>setPeriod(7)}>7 days</button><button className={period===30?"on":""} onClick={()=>setPeriod(30)}>30 days</button><button className={period===90?"on":""} onClick={()=>setPeriod(90)}>90 days</button><button style={{marginLeft:"auto"}} onClick={()=>void load()}><RefreshCw size={14}/> Refresh</button></div>
    <SummaryStrip items={[
      {icon:<Store/>,tone:"blue",value:events.filter(e=>e.kind==="visit").length,label:"Store visits"},
      {icon:<Eye/>,tone:"mint",value:events.filter(e=>e.kind==="product_view").length,label:"Product views"},
      {icon:<ChartNoAxesCombined/>,tone:"blue",value:events.filter(e=>e.kind==="search").length,label:"Searches"},
      {icon:<BadgeCheck/>,tone:"red",value:products.filter(p=>p.active).length,label:"Active products"},
    ]}/>
    <div className="settings-grid" style={{marginBottom:16}}>
      <div className="setting-card"><span className="sc-ico"><Store/></span><div><h3>{industries.filter(i=>i.active).length} active industries</h3><p>Public marketplace categories</p></div></div>
      <div className="setting-card"><span className="sc-ico"><BadgeCheck/></span><div><h3>{categories.filter(c=>c.active).length} active categories</h3><p>Visible in the storefront</p></div></div>
    </div>
    {failed?<PageError message="Website analytics could not be loaded. Check the site_events read policy."/>:
    <div className="table-panel" style={{padding:18,marginBottom:16}}>
      <div className="panel-head" style={{padding:0,border:0}}><div><ChartNoAxesCombined/><b>Top customer searches</b></div></div>
      {topSearches.length?<DataTable headers={["Search term","Searches","Latest"]} empty="" isEmpty={false}>{topSearches.map(([term,n])=><tr key={term}><td>{term}</td><td>{n}</td><td>{date(events.find(e=>e.term===term)?.created_at)}</td></tr>)}</DataTable>:<Empty message={loading?"Loading website activity…":"No customer searches recorded in this period."}/>}
    </div>}
    <DataTable headers={["Time","Event","Search term","Results","Storefront"]} empty={loading?"Loading website activity…":"No storefront activity in this period."} isEmpty={!events.length}>
      {events.slice(0,100).map(e=><tr key={e.id}><td>{stamp(e.created_at)}</td><td>{e.kind}</td><td>{e.term||"—"}</td><td>{e.results??"—"}</td><td>{e.mode||"—"}</td></tr>)}
    </DataTable>
    <p className="inline-note">Use the existing Products, Categories, Suppliers and Communication sections to change live storefront content and contact details. This page avoids duplicating those controls.</p>
  </>;
}

export function CustomerSupportPage() {
  const {profile,notify}=useAdmin();
  const tickets=useLoad<Row>("marketplace_support_tickets");
  const [showForm,setShowForm]=useState(false);
  const [busy,setBusy]=useState(false);
  const [notes,setNotes]=useState<Record<string,string>>({});
  const create=async(e:FormEvent<HTMLFormElement>)=>{
    e.preventDefault();const f=new FormData(e.currentTarget);setBusy(true);
    try{
      const {error}=await db().from("marketplace_support_tickets").insert({customer_name:String(f.get("customer_name")).trim(),email:String(f.get("email")||"").trim()||null,phone:String(f.get("phone")||"").trim()||null,subject:String(f.get("subject")).trim(),message:String(f.get("message")).trim(),priority:String(f.get("priority")),created_by:profile.id});
      if(error)throw error;notify("Support ticket created.");setShowForm(false);await tickets.load();
    }catch(err){notify(errorText(err,"Could not create support ticket"));}finally{setBusy(false);}
  };
  const update=async(r:Row,status:string)=>{
    const note=notes[r.id]??r.internal_note??"";
    const patch:Row={status,internal_note:note||null,assigned_to:r.assigned_to||profile.id,resolved_at:status==="resolved"||status==="closed"?new Date().toISOString():null};
    const {error}=await db().from("marketplace_support_tickets").update(patch).eq("id",r.id);
    if(error)notify(errorText(error,"Could not update ticket"));else{notify("Ticket updated.");await tickets.load();}
  };
  return <>
    <PageHeading title="Customer Support" sub="Create, assign and resolve customer support cases." action={<button className="btn green" onClick={()=>setShowForm(v=>!v)}><MessageSquare size={16}/> New ticket</button>}/>
    {showForm&&<div className="table-panel" style={{padding:18,marginBottom:16}}>
      <h3 style={{marginTop:0}}>Create support ticket</h3>
      <form className="form-grid" onSubmit={create}>
        <label>Customer name<input name="customer_name" required maxLength={120}/></label>
        <label>Email<input name="email" type="email" maxLength={160}/></label>
        <label>Phone<input name="phone" maxLength={40}/></label>
        <label>Priority<select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <label className="full">Subject<input name="subject" required maxLength={160}/></label>
        <label className="full">Customer message<textarea name="message" required rows={3} maxLength={4000}/></label>
        <button className="btn green full" disabled={busy}>{busy?"Creating…":"Create ticket"}</button>
      </form>
    </div>}
    <DataTable headers={["Created","Customer","Contact","Subject / message","Priority","Status","Internal note","Update"]} empty={tickets.loading?"Loading support tickets…":"No support tickets recorded."} isEmpty={!tickets.rows.length}>
      {tickets.rows.map(r=><tr key={r.id}><td>{date(r.created_at)}</td><td>{r.customer_name}</td><td>{r.email||r.phone||"—"}</td><td><b>{r.subject}</b><small>{r.message}</small></td><td><Status value={r.priority}/></td><td><Status value={r.status}/></td><td><input aria-label="Internal support note" value={notes[r.id]??r.internal_note??""} onChange={e=>setNotes(v=>({...v,[r.id]:e.target.value}))}/></td><td data-actions><select aria-label="Support ticket status" defaultValue={r.status} onChange={e=>void update(r,e.target.value)}><option value="open">Open</option><option value="in_progress">In progress</option><option value="waiting_customer">Waiting customer</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select></td></tr>)}
    </DataTable>
    <p className="inline-note"><ShieldCheck size={15}/> Internal notes are visible only to authorised TradeLink staff.</p>
  </>;
}
