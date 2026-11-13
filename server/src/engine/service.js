import crypto from 'crypto';
import {validate} from './conditions.js';
import {execute} from './executor.js';
const stable=o=>JSON.stringify(o,Object.keys(o).sort());
export class WorkflowService{
  constructor({repo,registry,services}){Object.assign(this,{repo,registry,services});}
  async submit(workflowId,payload,key){
    const wf=this.registry.get(workflowId);
    if(!wf) return {status:404,error:'Unknown workflow'};
    const errors=validate(wf.schema,payload);
    if(errors.length) return {status:422,errors};
    key=key||crypto.createHash('sha256').update(workflowId+stable(payload)).digest('hex');
    const ex=await this.repo.findByKey(workflowId,key);
    if(ex) return {status:200,duplicate:true,request:ex};
    const req={id:crypto.randomUUID(),workflowId,workflowVersion:wf.version,idempotencyKey:key,status:'RECEIVED',
      currentStage:wf.start,payload,context:{},history:[{from:null,to:'RECEIVED',at:new Date().toISOString()}]};
    try{await this.repo.insert(req);}
    catch(e){if(e.code===11000) return {status:200,duplicate:true,request:await this.repo.findByKey(workflowId,key)};throw e;}
    await this.repo.addAudit(req.id,{type:'received',workflowVersion:wf.version,payloadRef:`request:${req.id}.payload`});
    return {status:201,request:await this.run(req)};
  }
  run(req){ // always uses the workflow version pinned at intake
    return execute(req,this.registry.get(req.workflowId,req.workflowVersion),this);}
  async retry(id){
    const req=await this.repo.get(id);
    if(!req) return {status:404};
    if(req.status!=='PENDING_RETRY') return {status:409,error:`Cannot retry from ${req.status}`};
    await this.repo.addAudit(id,{type:'manual_retry',stage:req.currentStage});
    req.status='RECEIVED';return {status:200,request:await this.run(req)};
  }
  async review(id,{decision,reviewer,note}){
    const req=await this.repo.get(id);
    if(!req) return {status:404};
    if(req.status!=='MANUAL_REVIEW') return {status:409,error:`Cannot review from ${req.status}`};
    if(!['approved','rejected'].includes(decision)||!reviewer) return {status:422,errors:['decision (approved|rejected) and reviewer required']};
    const to=decision.toUpperCase();
    req.history.push({from:req.status,to,at:new Date().toISOString(),reason:`manual: ${reviewer}: ${note||''}`});
    await this.repo.addAudit(id,{type:'manual_decision',decision,reviewer,note});
    req.status=to;req.outcome={result:decision,reason:`manual review by ${reviewer}`};await this.repo.update(req);
    return {status:200,request:req};
  }
  async explain(id){
    const req=await this.repo.get(id);if(!req) return null;
    const audit=await this.repo.getAudit(id);
    const rules=audit.filter(a=>a.type==='rule_evaluated');
    return {requestId:id,workflow:`${req.workflowId}@${req.workflowVersion}`,input:req.payload,externalData:req.context,
      rulesTriggered:rules.map(r=>({rule:r.ruleId,pass:r.pass,dataUsed:r.checks})),
      outcome:req.outcome||null,status:req.status,stateHistory:req.history,
      summary:req.outcome?`${req.status}: ${req.outcome.reason}`:`${req.status} (awaiting ${req.currentStage})`};
  }
}
