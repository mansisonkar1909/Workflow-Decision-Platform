import {evaluate,get} from './conditions.js';
const T={approved:'APPROVED',rejected:'REJECTED',manual_review:'MANUAL_REVIEW'};
const sleep=ms=>ms?new Promise(r=>setTimeout(r,ms)):Promise.resolve();
// Runs stages from req.currentStage, checkpointing after every stage so a crash/failure resumes safely.
export async function execute(req,wf,{repo,services}){
  const audit=(type,d={})=>repo.addAudit(req.id,{type,stage:req.currentStage,workflowVersion:wf.version,...d});
  const move=async(to,reason)=>{
    req.history.push({from:req.status,to,at:new Date().toISOString(),reason});
    await audit('state_change',{from:req.status,to,reason});req.status=to;await repo.update(req);};
  const finish=async(outcome,reason)=>{if(outcome==='reject')outcome='rejected';req.outcome={result:outcome,reason};await move(T[outcome],reason);return req;};
  if(req.status!=='IN_PROGRESS') await move('IN_PROGRESS','execution started');
  for(let guard=0;guard<50;guard++){
    const st=wf.stages[req.currentStage];
    if(!st) throw new Error(`Unknown stage ${req.currentStage}`);
    const ctx={payload:req.payload,...req.context};
    if(st.type==='outcome') return finish(st.outcome,`reached outcome stage '${req.currentStage}'`);
    if(st.type==='rules'){
      for(const r of st.rules){
        const res=evaluate(r.when,ctx);
        await audit('rule_evaluated',{ruleId:r.id,pass:res.pass,checks:res.checks});
        if(!res.pass&&r.onFail!=='continue') return finish(r.onFail,`${r.id} failed: ${r.reason||''}`);
      }
      req.currentStage=st.next;
    } else if(st.type==='dependency'){
      const {attempts=1,backoffMs=0}=st.retry||{};let result,lastErr;
      for(let i=1;i<=attempts;i++){
        try{result=await services[st.service](Object.fromEntries(Object.entries(st.input).map(([k,p])=>[k,get(ctx,p)])));
          await audit('dependency_call',{service:st.service,attempt:i,ok:true,result});break;}
        catch(e){lastErr=e;await audit('dependency_call',{service:st.service,attempt:i,ok:false,error:e.message});await sleep(backoffMs*2**(i-1));}
      }
      if(!result){
        if(st.onExhausted==='manual_review') return finish('manual_review',`${st.service} unavailable`);
        req.error=lastErr.message;await move('PENDING_RETRY',`${st.service} failed after ${attempts} attempts`);return req;
      }
      req.context={...req.context,[st.store]:result};req.currentStage=st.next;
    } else if(st.type==='branch'){
      const hit=st.branches.find(b=>evaluate(b.when,ctx).pass);
      req.currentStage=hit?hit.goto:st.default;
      await audit('branch',{taken:req.currentStage,matched:!!hit});
    }
    await repo.update(req); // checkpoint
  }
  throw new Error('Workflow loop guard exceeded');
}
