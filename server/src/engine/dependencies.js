// Simulated external dependency: credit bureau. Deterministic by PAN prefix; failures injectable.
let failures=0;
export const creditBureau={
  failNext:n=>{failures=n;},
  async call({pan}){
    if(failures>0){failures--;throw new Error('creditBureau: 503 Service Unavailable');}
    return {score:pan.startsWith('LOW')?450:pan.startsWith('HIGH')?800:700,source:'creditBureau-sim'};
  }};
export const defaultServices={
  creditBureau:i=>creditBureau.call(i),
  policyService:async({policyNo})=>({active:!policyNo.startsWith('EXP'),coverageLimit:policyNo.startsWith('SML')?20000:100000})
};
