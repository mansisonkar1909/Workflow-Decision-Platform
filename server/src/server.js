import {fileURLToPath} from 'url';import path from 'path';
import {buildApp} from './app.js';import {Registry} from './engine/registry.js';
import {WorkflowService} from './engine/service.js';import {defaultServices} from './engine/dependencies.js';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'../config/workflows');
let repo;
if(process.env.MONGO_URI){repo=new (await import('./repo/mongo.js')).MongoRepo(process.env.MONGO_URI);}
else{console.warn('MONGO_URI not set -> in-memory repo');repo=new (await import('./repo/memory.js')).MemoryRepo();}
const svc=new WorkflowService({repo,registry:new Registry(dir),services:defaultServices});
buildApp(svc).listen(process.env.PORT||4000,()=>console.log('API on :'+(process.env.PORT||4000)));
