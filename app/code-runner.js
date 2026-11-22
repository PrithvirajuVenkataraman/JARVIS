/** Execute explicitly requested snippets in an opaque-origin frame with networking disabled. */
export function executeJavaScript(code, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const token = crypto.randomUUID();
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.title = 'Isolated JavaScript execution';
        const clean = () => { clearTimeout(timer); window.removeEventListener('message', receive); frame.remove(); };
        const receive = event => {
            if (event.source !== frame.contentWindow || event.data?.token !== token) return;
            const value = event.data;
            clean();
            if (value.error) reject(new Error(value.error)); else resolve(value);
        };
        const timer = setTimeout(() => { clean(); reject(new Error('Code execution exceeded its time limit.')); }, timeoutMs);
        window.addEventListener('message', receive);
        const data = JSON.stringify({ code: String(code), token }).replaceAll('<', '\\u003c');
        const workerProgram = `
const input=${data};
const logs=[];
const format=value=>{try{return typeof value==='string'?value:JSON.stringify(value)}catch{return String(value)}};
const output={};
for(const level of ['log','info','warn','error','debug'])output[level]=(...args)=>{if(logs.length<100)logs.push({level,text:args.map(format).join(' ').slice(0,20000)})};
(async()=>{try{const run=new (Object.getPrototypeOf(async function(){}).constructor)('console',input.code);const result=await run(output);postMessage({token:input.token,logs,result:format(result)})}catch(error){postMessage({token:input.token,error:String(error.message).slice(0,2000)})}})();
`;
        const program = JSON.stringify(workerProgram).replaceAll('<', '\\u003c');
        frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; worker-src blob:; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'"><script>
const worker = new Worker(URL.createObjectURL(new Blob([${program}], {type:'text/javascript'})));
worker.onmessage = event => parent.postMessage(event.data, '*');
worker.onerror = () => parent.postMessage({token:${JSON.stringify(token)},error:'The isolated worker could not start.'}, '*');
</script>`;
        document.body.append(frame);
    });
}
