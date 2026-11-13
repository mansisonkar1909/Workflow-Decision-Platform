import fs from 'fs';import path from 'path';
export class Registry{
  constructor(dir){this.dir=dir;this.v=new Map();if(dir)this.reload();}
  register(wf){this.v.set(`${wf.id}@${wf.version}`,wf);}
  reload(){for(const f of fs.readdirSync(this.dir).filter(f=>f.endsWith('.json')))
    this.register(JSON.parse(fs.readFileSync(path.join(this.dir,f),'utf8')));}
  get(id,version){
    if(version) return this.v.get(`${id}@${version}`);
    const all=[...this.v.values()].filter(w=>w.id===id);
    return all.sort((a,b)=>b.version-a.version)[0];}
  list(){return [...this.v.values()].map(({id,version,schema})=>({id,version,schema}));}
}
