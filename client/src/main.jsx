import React,{useEffect,useState,useCallback} from 'react';import {createRoot} from 'react-dom/client';import './styles.css';
const PRESETS={
 'Happy path':{applicantId:'A-1001',name:'Ravi Kumar',age:30,income:100000,amount:200000,pan:'OKAY1'},
 'Under age':{applicantId:'A-1002',name:'Teen User',age:17,income:50000,amount:10000,pan:'OKAY2'},
 'Low credit':{applicantId:'A-1003',name:'Low Score',age:35,income:100000,amount:50000,pan:'LOW77'},
 'Needs review':{applicantId:'A-1004',name:'Big Ask',age:40,income:100000,amount:900000,pan:'OKAY3'},
 'Excellent credit':{applicantId:'A-1005',name:'Top Score',age:45,income:200000,amount:550000,pan:'HIGH9'}};
const api=async(u,o={},key)=>{
  const r=await fetch(u,{headers:{'Content-Type':'application/json',...(key&&{'Idempotency-Key':key})},...o});
  if(r.status===404) return {status:404,error:'Not found'};
  const j=await r.json().catch(()=>({}));
  return Array.isArray(j)?j:{http:r.status,...j};
};
const post=(u,b)=>({method:'POST',body:JSON.stringify(b||{})});
const Badge=({s})=><span className={`badge ${s}`}>{s.replace('_',' ')}</span>;

function App(){
  const [wfs,setWfs]=useState([]);const [wf,setWf]=useState('');const [form,setForm]=useState({});
  const [key,setKey]=useState('');const [fail,setFail]=useState(0);const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState(null);const [ex,setEx]=useState(null);const [audit,setAudit]=useState([]);
  const [list,setList]=useState([]);const [showAudit,setShowAudit]=useState(false);
  const refreshList=useCallback(async()=>{const l=await api('/api/requests');setList(Array.isArray(l)?l.slice(-8).reverse():[]);},[]);
  useEffect(()=>{api('/api/workflows').then(w=>{if(Array.isArray(w)&&w.length){setWfs(w);setWf(w[0].id);}});refreshList();},[]);
  const schema=wfs.find(w=>w.id===wf)?.schema||{};
  const load=async id=>{setEx(await api(`/api/requests/${id}/explain`));setAudit(await api(`/api/requests/${id}/audit`));refreshList();};
  const submit=async()=>{
    setBusy(true);setMsg(null);
    const payload=Object.fromEntries(Object.entries(form).filter(([,v])=>v!=='').map(([k,v])=>[k,schema[k]?.type==='number'?Number(v):schema[k]?.type==='boolean'?v==='true':v]));
    await api('/api/simulate/bureau-failures',post('',{count:fail}));
    const r=await api(`/api/workflows/${wf}/requests`,post('',payload),key||undefined);
    if(r.errors) setMsg({err:true,t:'Validation failed: '+r.errors.join('; ')});
    else if(r.error) setMsg({err:true,t:r.error});
    else{if(r.duplicate)setMsg({t:'Duplicate request detected - returned the original decision (idempotent).'});await load(r.request.id);}
    setBusy(false);};
  const act=async(path,body)=>{setBusy(true);const r=await api(`/api/requests/${ex.requestId}/${path}`,post('',body));
    if(r.error)setMsg({err:true,t:r.error});await load(ex.requestId);setBusy(false);};
  const status=ex?.status;
  return <>
  <header><h1>Workflow Decision Platform</h1><p>Config-driven rules, audit trail, retries and idempotency</p></header>
  <div className="layout"><div>
    <div className="card"><h3>New request</h3>
      <label>Workflow</label><select value={wf} onChange={e=>{setWf(e.target.value);setForm({});}}>{wfs.map(w=><option key={w.id}>{w.id}</option>)}</select>
      {wf==='loan_approval'&&<><label>Quick scenarios</label><div className="chips">
        {Object.entries(PRESETS).map(([n,p])=><button key={n} className="ghost" onClick={()=>setForm(p)}>{n}</button>)}</div></>}
      {Object.entries(schema).map(([k,s])=><div key={k}><label>{k}{s.required&&' *'} <span className="mute">({s.type}{s.min!=null?`, min ${s.min}`:''})</span></label>
        {s.type==='boolean'
          ? <select value={form[k]??''} onChange={e=>setForm({...form,[k]:e.target.value})}><option value="">Select</option><option value="true">Yes</option><option value="false">No</option></select>
          : <input type={s.type==='number'?'number':'text'} value={form[k]??''} onChange={e=>setForm({...form,[k]:e.target.value})}/>}</div>)}
      <label>Idempotency key (optional - reuse to test duplicates)</label><input value={key} onChange={e=>setKey(e.target.value)} placeholder="e.g. demo-123"/>
      <label>Simulate credit-bureau failures</label>
      <select value={fail} onChange={e=>setFail(+e.target.value)}><option value={0}>None</option><option value={2}>2 failures (recovers via retry)</option><option value={3}>3 failures (goes to PENDING_RETRY)</option></select>
      <div className="row"><button disabled={busy||!wf} onClick={submit}>{busy?'Processing...':'Submit request'}</button></div>
    </div>
    <div className="card"><h3>Recent requests</h3>{list.length===0&&<div className="mute">None yet</div>}
      {list.map(r=><div key={r.id} className="hist" onClick={()=>load(r.id)}><span>{r.payload?.name||r.payload?.vendorName||r.payload?.claimId||r.id.slice(0,8)}<br/><span className="mute">{r.workflowId}@v{r.workflowVersion}</span></span><Badge s={r.status}/></div>)}</div>
  </div><div>
    {msg&&<div className={`alert ${msg.err?'err':''}`}>{msg.t}</div>}
    {!ex?<div className="card empty">Submit a request or pick a scenario to see the decision explanation.</div>:<>
    <div className="card"><div className="hero"><div><Badge s={status}/><h2>{ex.summary}</h2>
      <div className="mute">{ex.workflow} · request {ex.requestId.slice(0,8)}</div></div>
      <div className="row" style={{margin:0}}>
        {status==='PENDING_RETRY'&&<button disabled={busy} onClick={()=>act('retry')}>Retry now</button>}
        {status==='MANUAL_REVIEW'&&<><button className="ok" disabled={busy} onClick={()=>act('review',{decision:'approved',reviewer:'ops.user',note:'UI'})}>Approve</button>
          <button className="bad" disabled={busy} onClick={()=>act('review',{decision:'rejected',reviewer:'ops.user',note:'UI'})}>Reject</button></>}</div></div></div>
    <div className="card"><h3>Rules evaluated</h3>{ex.rulesTriggered.length===0&&<div className="mute">No rules evaluated yet</div>}
      {ex.rulesTriggered.map((r,i)=><div className="rule" key={i}><div className={`dot ${r.pass?'pass':'fail'}`}>{r.pass?'✓':'✕'}</div>
        <div><b>{r.rule}</b><div className="mute">{r.dataUsed.map((d,j)=><span key={j}>actual <code>{String(d.actual)}</code> {d.op} expected <code>{String(d.expected)}</code> on <code>{d.field}</code> </span>)}</div></div></div>)}</div>
    <div className="card"><h3>External data &amp; input</h3><pre>{JSON.stringify({input:ex.input,externalData:ex.externalData},null,2)}</pre></div>
    <div className="card"><h3>State history</h3><div className="tl">{ex.stateHistory.map((h,i)=><div key={i}><b>{h.from||'—'} → {h.to}</b> <span className="mute">{new Date(h.at).toLocaleTimeString()}</span><div className="mute">{h.reason}</div></div>)}</div></div>
    <div className="card"><h3>Audit log ({audit.length} events) <button className="ghost" style={{float:'right',padding:'2px 8px'}} onClick={()=>setShowAudit(!showAudit)}>{showAudit?'Hide':'Show'}</button></h3>
      {showAudit&&<pre>{audit.map(a=>`#${a.seq} ${a.type}${a.stage?' ['+a.stage+']':''} ${a.ruleId||a.service||a.to||''} ${a.pass!==undefined?(a.pass?'PASS':'FAIL'):''}${a.ok!==undefined?(a.ok?'ok':'FAILED '+a.error):''}`).join('\n')}</pre>}</div></>}
  </div></div></>;}
createRoot(document.getElementById('root')).render(<App/>);