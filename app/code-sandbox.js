// This document is loaded only inside an opaque sandbox. No application state,
// storage access, credentials or networking is available to the worker.
let started = false;
addEventListener('message', event => {
    if (started || event.source !== parent || !event.data?.token || typeof event.data.code !== 'string') return;
    started = true;
    const input = JSON.stringify({ token: event.data.token, code: event.data.code }).replaceAll('<', '\\u003c');
    const program = `const input=${input};
const logs=[];
const format=value=>{try{return typeof value==='string'?value:JSON.stringify(value)}catch{return String(value)}};
const output={};
for(const level of ['log','info','warn','error','debug'])output[level]=(...args)=>{if(logs.length<100)logs.push({level,text:args.map(format).join(' ').slice(0,20000)})};
(async()=>{try{const run=new(Object.getPrototypeOf(async function(){}).constructor)('console',input.code);const result=await run(output);postMessage({token:input.token,logs,result:format(result)})}catch(error){postMessage({token:input.token,error:String(error.message).slice(0,2000)})}})();`;
    const url = URL.createObjectURL(new Blob([program], { type: 'text/javascript' }));
    const worker = new Worker(url);
    worker.onmessage = value => { parent.postMessage(value.data, '*'); worker.terminate(); URL.revokeObjectURL(url); };
    worker.onerror = () => { parent.postMessage({ token: event.data.token, error: 'The isolated worker could not start.' }, '*'); worker.terminate(); URL.revokeObjectURL(url); };
});
