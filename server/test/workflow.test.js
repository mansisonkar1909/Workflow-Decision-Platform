import test from 'node:test';import assert from 'node:assert/strict';
import path from 'path';import {fileURLToPath} from 'url';
import {Registry} from '../src/engine/registry.js';import {WorkflowService} from '../src/engine/service.js';
import {MemoryRepo} from '../src/repo/memory.js';import {creditBureau,defaultServices} from '../src/engine/dependencies.js';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'../config/workflows');
const mk=()=>new WorkflowService({repo:new MemoryRepo(),registry:new Registry(dir),services:defaultServices});
const app=(o={})=>({applicantId:'A1',name:'Ravi',age:30,income:100000,amount:200000,pan:'OKAY1',...o});

test('happy path approves and records rule trace',async()=>{
  const s=mk();const r=await s.submit('loan_approval',app());
  assert.equal(r.request.status,'APPROVED');
  const ex=await s.explain(r.request.id);
  assert.deepEqual(ex.rulesTriggered.map(x=>x.rule),['R1_age_18_plus','R2_min_credit_score','R3_amount_within_3x_income','R4_auto_approve_limit']);
  assert.equal(ex.rulesTriggered[1].dataUsed[0].actual,700);
});
test('invalid input rejected with 422 and nothing persisted',async()=>{
  const s=mk();const r=await s.submit('loan_approval',{name:5,age:-1});
  assert.equal(r.status,422);assert.ok(r.errors.length>=3);assert.equal((await s.repo.list()).length,0);
});
test('mandatory rule failure rejects',async()=>{
  const r=await mk().submit('loan_approval',app({age:17}));assert.equal(r.request.status,'REJECTED');
});
test('threshold -> manual review -> human decision',async()=>{
  const s=mk();const r=await s.submit('loan_approval',app({amount:900000}));
  assert.equal(r.request.status,'MANUAL_REVIEW');
  const d=await s.review(r.request.id,{decision:'approved',reviewer:'meera'});
  assert.equal(d.request.status,'APPROVED');
  assert.ok((await s.repo.getAudit(r.request.id)).some(a=>a.type==='manual_decision'));
});
test('duplicate request is idempotent (explicit key and payload hash)',async()=>{
  const s=mk();const a=await s.submit('loan_approval',app(),'k1');
  const b=await s.submit('loan_approval',app({amount:1}),'k1');
  const c=await s.submit('loan_approval',app({applicantId:'Z'}));const d=await s.submit('loan_approval',app({applicantId:'Z'}));
  assert.equal(b.duplicate,true);assert.equal(b.request.id,a.request.id);assert.equal(d.request.id,c.request.id);
  assert.equal((await s.repo.list()).length,2);
});
test('dependency failure: retries inside stage then recovers',async()=>{
  const s=mk();creditBureau.failNext(2);
  const r=await s.submit('loan_approval',app());assert.equal(r.request.status,'APPROVED');
  assert.equal((await s.repo.getAudit(r.request.id)).filter(a=>a.type==='dependency_call'&&!a.ok).length,2);
});
test('dependency outage -> PENDING_RETRY -> manual retry resumes without re-running earlier stages',async()=>{
  const s=mk();creditBureau.failNext(3);
  const r=await s.submit('loan_approval',app());assert.equal(r.request.status,'PENDING_RETRY');
  assert.equal(r.request.currentStage,'bureau');
  assert.equal((await s.retry(r.request.id)).request.status,'APPROVED');
  const log=await s.repo.getAudit(r.request.id);
  assert.equal(log.filter(a=>a.ruleId==='R1_age_18_plus').length,1);
  assert.equal((await s.retry(r.request.id)).status,409);
});
test('rule change: new version applies to new requests; in-flight stay pinned',async()=>{
  const s=mk();creditBureau.failNext(3);
  const old=await s.submit('loan_approval',app({applicantId:'OLD',pan:'LOWX',amount:1000}));// pending at bureau, v1
  const v2=structuredClone(s.registry.get('loan_approval'));v2.version=2;
  v2.stages.thresholds.rules[0].when.value=400; // relax min score 600 -> 400
  s.registry.register(v2);
  assert.equal(old.request.status,'PENDING_RETRY');
  assert.equal((await s.retry(old.request.id)).request.status,'REJECTED'); // still v1 rules (450<600)
  const nu=await s.submit('loan_approval',app({applicantId:'NEW',pan:'LOWX',amount:1000}));
  assert.equal(nu.request.workflowVersion,2);assert.equal(nu.request.status,'APPROVED');
});
