import mongoose from 'mongoose';
const {Schema}=mongoose;
const R=mongoose.model('Request',new Schema({_id:String,workflowId:String,workflowVersion:Number,idempotencyKey:String,
  status:String,currentStage:String,payload:Object,context:Object,history:Array,outcome:Object,error:String},{minimize:false})
  .index({workflowId:1,idempotencyKey:1},{unique:true})); // DB-level idempotency guard (race-safe)
const A=mongoose.model('Audit',new Schema({requestId:{type:String,index:true},seq:Number},{strict:false,timestamps:false}));
const out=d=>d&&{...d,id:d._id,_id:undefined,__v:undefined};
export class MongoRepo{
  constructor(uri){this.ready=mongoose.connect(uri);}
  async insert(r){await this.ready;await R.create({...r,_id:r.id});}
  async update(r){await R.replaceOne({_id:r.id},{...r,_id:r.id});}
  async get(id){return out(await R.findById(id).lean());}
  async findByKey(w,k){return out(await R.findOne({workflowId:w,idempotencyKey:k}).lean());}
  async addAudit(id,e){const seq=(await A.countDocuments({requestId:id}))+1;await A.create({requestId:id,seq,ts:new Date().toISOString(),...e});}
  async getAudit(id){return A.find({requestId:id}).sort({seq:1}).lean();}
  async list(){return (await R.find().lean()).map(out);}
}
