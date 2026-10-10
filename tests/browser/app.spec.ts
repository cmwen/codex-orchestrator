import { test, expect } from '@playwright/test';
const state = {workspaces:[{id:'w1',name:'Website',path:'/tmp/website',documents:[{name:'README.md',text:'A personal website.'}],indexedAt:new Date().toISOString()}],sessions:[],config:{routerUrl:'http://127.0.0.1:4000/v1',decisionModel:'router'},codexConnected:true};
test('empty state, settings, mobile layout and workspace navigation', async ({page}) => {
 await page.goto('/'); await expect(page.getByRole('heading',{name:'What are we working on?'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send task'})).toBeDisabled();
 await page.getByRole('button',{name:'Connect companion'}).click();
 await expect(page.getByRole('dialog')).toBeVisible(); await page.getByLabel('Companion URL').fill('http://127.0.0.1:4317');
 await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.setViewportSize({width:390,height:844});
 await expect(page.getByRole('heading',{name:'What are we working on?'})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
 await page.screenshot({path:'test-results/mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 await page.screenshot({path:'test-results/overview.png',fullPage:true});
});
test('paired task flow shows results and routing decisions', async ({page}) => {
 let current:any=structuredClone(state);
 await page.addInitScript(()=>{sessionStorage.setItem('orbit-token','test-token');});
 await page.route('http://127.0.0.1:4317/api/**',async route=>{
  const request=route.request(), url=new URL(request.url());
  if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:5187','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,PATCH'}});return;}
  if(url.pathname==='/api/sessions' && request.method()==='POST') {
   current.sessions=[{id:'s1',title:'Improve the website',status:'completed',archived:false,workspaceId:'w1',workspaceName:'Website',updatedAt:new Date().toISOString(),decisions:[{workspaceId:'w1',workspaceName:'Website',model:'test-codex',effort:'medium',confidence:.92,reason:'The website workspace owns the requested pages.',decisionModel:'router',durationMs:400,sources:['README.md'],decidedAt:new Date().toISOString()}],messages:[{id:'u1',role:'user',text:'Improve the website'},{id:'a1',role:'assistant',text:'Updated the homepage and verified the responsive layout.'}],activity:[],approvals:[]}];
   await route.fulfill({json:current.sessions[0],headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:5187'}});return;
  }
  await route.fulfill({json:current,headers:{'Access-Control-Allow-Origin':'http://127.0.0.1:5187'}});
 });
 await page.routeWebSocket('ws://127.0.0.1:4317/events',ws=>{ws.onMessage(()=>{ws.send(JSON.stringify({type:'state',state:current}));});});
 await page.goto('/');await expect(page.getByText('Local connected',{exact:true})).toBeVisible();
 await page.getByLabel('New task').fill('Improve the website');await page.getByRole('button',{name:'Send task'}).click();
 // Reconnect triggers a fresh snapshot, like the companion's live broadcast.
 await page.reload();await page.getByRole('button').filter({hasText:'Improve the website'}).click();
 await expect(page.getByText('Updated the homepage and verified the responsive layout.')).toBeVisible();
 await expect(page.getByText('The website workspace owns the requested pages.')).toBeVisible();
 await expect(page.getByText('92% confidence')).toBeVisible();
 await page.screenshot({path:'test-results/session.png',fullPage:true});
});
