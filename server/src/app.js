import express from 'express';import cors from 'cors';import {creditBureau} from './engine/dependencies.js';
export function buildApp(svc){
  const app=express();app.use(cors(),express.json());
  const send=(res,r)=>res.status(r.status||200).json(r);
    app.post('/api/simulate/bureau-failures',(q,res)=>{creditBureau.failNext(Number(q.body.count)||0);res.json({ok:true});});
  app.get('/api/workflows',(q,res)=>res.json(svc.registry.list()));
  app.post('/api/workflows/reload',(q,res)=>{svc.registry.reload();res.json(svc.registry.list());});
  app.post('/api/workflows/:id/requests',async(q,res,next)=>{
    try{send(res,await svc.submit(q.params.id,q.body,q.header('Idempotency-Key')));}catch(e){next(e);}});
  app.get('/api/requests',async(q,res)=>res.json(await svc.repo.list()));
  app.get('/api/requests/:id',async(q,res)=>{const r=await svc.repo.get(q.params.id);r?res.json(r):res.sendStatus(404);});
  app.get('/api/requests/:id/audit',async(q,res)=>res.json(await svc.repo.getAudit(q.params.id)));
  app.get('/api/requests/:id/explain',async(q,res)=>{const e=await svc.explain(q.params.id);e?res.json(e):res.sendStatus(404);});
  app.post('/api/requests/:id/retry',async(q,res,next)=>{try{send(res,await svc.retry(q.params.id));}catch(e){next(e);}});
  app.post('/api/requests/:id/review',async(q,res,next)=>{try{send(res,await svc.review(q.params.id,q.body));}catch(e){next(e);}});
  app.use((e,q,res,n)=>res.status(500).json({error:e.message}));
  return app;
}
