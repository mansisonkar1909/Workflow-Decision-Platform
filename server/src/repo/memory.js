// In-memory repo: same interface as the Mongo repo (used by tests and zero-setup demo).
export class MemoryRepo{
  constructor(){this.reqs=new Map();this.keys=new Map();this.logs=new Map();}
  async insert(r){const k=`${r.workflowId}:${r.idempotencyKey}`;
    if(this.keys.has(k)) throw Object.assign(new Error('dup'),{code:11000});
    this.keys.set(k,r.id);this.reqs.set(r.id,structuredClone(r));}
  async update(r){this.reqs.set(r.id,structuredClone(r));}
  async get(id){const r=this.reqs.get(id);return r&&structuredClone(r);}
  async findByKey(w,k){const id=this.keys.get(`${w}:${k}`);return id?this.get(id):null;}
  async addAudit(id,e){const l=this.logs.get(id)||[];l.push({seq:l.length+1,ts:new Date().toISOString(),requestId:id,...e});this.logs.set(id,l);}
  async getAudit(id){return structuredClone(this.logs.get(id)||[]);}
  async list(){return [...this.reqs.values()];}
}
