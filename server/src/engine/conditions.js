export const get=(o,p)=>p.split('.').reduce((a,k)=>a==null?undefined:a[k],o);
const ops={eq:(a,b)=>a===b,ne:(a,b)=>a!==b,gt:(a,b)=>a>b,gte:(a,b)=>a>=b,lt:(a,b)=>a<b,lte:(a,b)=>a<=b,
 in:(a,b)=>Array.isArray(b)&&b.includes(a),exists:a=>a!=null};
// Returns {pass, checks:[{field,op,expected,actual}]} - checks are the data references used in the audit trail.
export function evaluate(c,ctx){
  if(c.all||c.any){const r=(c.all||c.any).map(x=>evaluate(x,ctx));
    return {pass:c.all?r.every(x=>x.pass):r.some(x=>x.pass),checks:r.flatMap(x=>x.checks)};}
  if(!ops[c.op]) throw new Error(`Unknown operator ${c.op}`);
  const actual=get(ctx,c.field);
  const expected=c.valueFrom?get(ctx,c.valueFrom)*(c.factor??1):c.value;
  return {pass:!!ops[c.op](actual,expected),checks:[{field:c.field,op:c.op,expected,actual}]};
}
export function validate(schema,p){
  const errors=[];
  if(!p||typeof p!=='object') return ['payload must be an object'];
  for(const [k,s] of Object.entries(schema)){
    const v=p[k];
    if(v==null){if(s.required)errors.push(`${k} is required`);continue;}
    if(typeof v!==s.type||(s.type==='number'&&!Number.isFinite(v))){errors.push(`${k} must be ${s.type}`);continue;}
    if(s.min!=null&&v<s.min)errors.push(`${k} must be >= ${s.min}`);
    if(s.max!=null&&v>s.max)errors.push(`${k} must be <= ${s.max}`);
    if(s.enum&&!s.enum.includes(v))errors.push(`${k} must be one of ${s.enum}`);
  }
  return errors;
}
