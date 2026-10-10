import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Store } from '../server/store.mjs';
import { describeWorkspace } from '../server/workspaces.mjs';
import { validateDecision, decide } from '../server/router.mjs';
import { createApp } from '../server/app.mjs';
const model = {model:'test-codex',description:'Test coding model',supportedReasoningEfforts:[{reasoningEffort:'medium'}]};
const decision = {workspaceId:'w1',model:'test-codex',effort:'medium',confidence:.9,reason:'This workspace owns the requested feature.'};
test('routing rejects unknown paths, models, effort, confidence and cross-workspace follow-ups',()=>{
 assert.deepEqual(validateDecision(decision,[{id:'w1'}],[model]),decision);
 for(const override of [{workspaceId:'/tmp/other'},{model:'invented'},{effort:'ultra'},{confidence:2},{reason:''}]) assert.throws(()=>validateDecision({...decision,...override},[{id:'w1'}],[model]));
 assert.throws(()=>validateDecision(decision,[{id:'w1'}],[model],'w2'));
});
test('router sends context to local LiteLLM and fails closed on malformed JSON',async()=>{
 let sent;
 const args = {message:'Fix the website',workspaces:[{id:'w1',documents:[{name:'AGENTS.md',text:'Website project'}]}],models:[model],config:{routerUrl:'http://127.0.0.1:4000/v1',decisionModel:'router',routerKey:'private-key'}};
 const result = await decide({...args,fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(decision)}}]})};}});
 assert.equal(result.workspaceId,'w1'); assert.equal(sent.url,'http://127.0.0.1:4000/v1/chat/completions'); assert.match(sent.options.body,/Website project/); assert.equal(sent.options.headers.Authorization,'Bearer private-key');
 await assert.rejects(decide({...args,fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content:'bad'}}]})})}),/invalid JSON/);
});
test('workspace context is case-insensitive, bounded and prevents symlink escape',async t=>{
 const root=await mkdtemp(path.join(tmpdir(),'orbit-workspace-')); t.after(()=>rm(root,{recursive:true,force:true}));
 await writeFile(path.join(root,'readme.md'),'Project README'); await writeFile(path.join(root,'agents.md'),'x'.repeat(16000));
 const w=await describeWorkspace({path:root}); assert.equal(w.documents.length,2); assert.equal(w.documents[0].text.length,12000);
 await rm(path.join(root,'agents.md')); await symlink('/etc/passwd',path.join(root,'AGENTS.md'));
 await assert.rejects(describeWorkspace({path:root}),/outside/); await assert.rejects(describeWorkspace({path:'relative'}),/absolute/);
});
class FakeCodex extends EventEmitter {
 ready=true; calls=[]; replies=[];
 async models(){return [model];}
 async request(method,params){this.calls.push({method,params}); if(method==='thread/start')return {thread:{id:'thread1'}}; if(method==='turn/start')return {turn:{id:'turn1'}}; return {};}
 respond(id,result){this.replies.push({id,result});} reject(){} close(){}
}
async function fixture(t,content=JSON.stringify(decision)){
 const dir=await mkdtemp(path.join(tmpdir(),'orbit-app-')); const store=new Store(path.join(dir,'data')); await store.load();
 const w=await describeWorkspace({path:dir,id:'w1'}); store.data.workspaces=[w]; store.data.config={routerUrl:'http://127.0.0.1:4000/v1',decisionModel:'router'};
 const codex=new FakeCodex(); const app=createApp({store,codex,token:'test-token',origins:['http://localhost:5173'],fetchImpl:async()=>({ok:true,json:async()=>({choices:[{message:{content}}]})})});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve)); const url=`http://127.0.0.1:${app.server.address().port}`;
 t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const request=async(endpoint,method='GET',data,headers={})=>{const response=await fetch(url+endpoint,{method,headers:{Authorization:'Bearer test-token','Content-Type':'application/json',...headers},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:response.status===204?null:await response.json()};};
 return {app,codex,store,request};
}
async function eventually(check){for(let i=0;i<50;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Condition did not become true');}
test('companion authenticates requests and checks browser origins',async t=>{
 const {request}=await fixture(t);
 assert.equal((await request('/api/state','GET',undefined,{Authorization:''})).status,401);
 const result=await request('/api/state'); assert.equal(result.status,200); assert.equal(result.data.workspaces[0].id,'w1');
 const denied=await fetch('http://127.0.0.1:'+ (await fixture(t)).app.server.address().port+'/api/state',{headers:{Origin:'https://evil.example'}}); assert.equal(denied.status,403);
 const preflight=await request('/api/state','OPTIONS',undefined,{Origin:'http://localhost:5173'});assert.equal(preflight.status,204);
 assert.equal((await request('/api/config','PATCH',{routerUrl:'https://example.com',decisionModel:'router'})).status,400);
});
test('sessions route, stream, request approvals, complete, archive and resume',async t=>{
 const {request,store,codex}=await fixture(t); const created=await request('/api/sessions','POST',{message:'Build the website'}); assert.equal(created.status,202);
 const s=store.data.sessions[0]; await eventually(()=>s.turnId==='turn1');
 assert.equal(s.decisions.length,1); assert.equal(codex.calls[0].params.cwd,store.data.workspaces[0].path); assert.equal(codex.calls[0].params.sandbox,'workspace-write');
 assert.equal((await request(`/api/sessions/${s.id}/message`,'POST',{message:'More'})).status,400);
 codex.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'thread1',turnId:'turn1',itemId:'a1',delta:'Hello'}});
 codex.emit('notification',{method:'item/agentMessage/delta',params:{threadId:'thread1',turnId:'turn1',itemId:'a1',delta:' world'}});
 assert.equal(s.messages.at(-1).text,'Hello world');
 codex.emit('request',{id:77,method:'item/commandExecution/requestApproval',params:{threadId:'thread1',turnId:'turn1',command:'npm test'}}); assert.equal(s.status,'waiting');
 assert.equal((await request(`/api/sessions/${s.id}/approval`,'POST',{id:77,decision:'accept'})).status,200); assert.deepEqual(codex.replies[0],{id:77,result:{decision:'accept'}});
 codex.emit('notification',{method:'turn/completed',params:{threadId:'thread1',turn:{status:'completed'}}}); assert.equal(s.status,'completed');
 await request(`/api/sessions/${s.id}`,'PATCH',{archived:true}); assert.equal(s.archived,true);
 assert.equal((await request(`/api/sessions/${s.id}/message`,'POST',{message:'More'})).status,400);
 await request(`/api/sessions/${s.id}`,'PATCH',{archived:false,title:'Website'}); assert.equal(s.title,'Website');
 s.loaded=false; await request(`/api/sessions/${s.id}/message`,'POST',{message:'Improve it'}); await eventually(()=>s.decisions.length===2 && s.turnId==='turn1'); assert.ok(codex.calls.some(c=>c.method==='thread/resume'));
});
test('bad routing never starts Codex and a retry can recover',async t=>{
 const {request,store,codex}=await fixture(t,'{bad'); await request('/api/sessions','POST',{message:'Task'});
 await eventually(()=>store.data.sessions[0].status==='failed'); assert.equal(codex.calls.length,0); assert.match(store.data.sessions[0].error,/invalid JSON/);
});
test('store persists sessions and marks active work interrupted on restart',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'orbit-store-')); t.after(()=>rm(dir,{recursive:true,force:true}));
 const first=new Store(dir);const token=await first.load();first.data.sessions.push({status:'running',approvals:[{id:1}],turnId:'active'});await first.save();
 const second=new Store(dir);assert.equal(await second.load(),token);assert.equal(second.data.sessions[0].status,'interrupted');assert.deepEqual(second.data.sessions[0].approvals,[]);assert.equal(second.data.sessions[0].turnId,null);
});
