import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const root=resolve(process.argv[2]);
await import(pathToFileURL(`${root}/node_modules/fake-indexeddb/auto/index.mjs`).href);
registerHooks({resolve(specifier,ctx,next){if((specifier.startsWith('./')||specifier.startsWith('../'))&&ctx.parentURL){const p=new URL(`${specifier}.ts`,ctx.parentURL);if(existsSync(p))return{url:p.href,shortCircuit:true};}return next(specifier,ctx);},load(url,ctx,next){if(url.endsWith('.json'))return{format:'module',source:`export default ${readFileSync(new URL(url),'utf8')}`,shortCircuit:true};return next(url,ctx);}});
const source=p=>import(pathToFileURL(`${root}/${p}`).href);
const {buildDividendAdvisorContext}=await source('src/lib/dividendAdvisor.ts');
const {defaultDividendFundPlan}=await source('src/lib/dividendFundPlan.ts');
const {defaultDividendSelectionPrinciples}=await source('src/lib/dividendResearch.ts');
const {askDividendAdvisorWithActions}=await source('src/services/dividendAdvisorService.ts');
const now=Date.parse('2026-10-31T03:00:00Z');
const stock={code:'601398',name:'模拟银行',group:'core',weightBps:10000,shareMode:'manual',manualShares:200,lotSize:100,buyPaused:true,buyLevels:[{priceMinor:1000,yieldBps:550,portionBps:10000}],sellLevels:[{priceMinor:1200,yieldBps:480,portionBps:10000}],quote:{priceMinor:900,date:'2026-10-31 10:00',fetchedAt:now}};
const ctx=buildDividendAdvisorContext({stocks:[stock],strategy:'stocks',budgetMinor:1000000,budgetConfigured:true,positions:new Map(),fundPlan:defaultDividendFundPlan(),research:{generatedAt:now,principles:defaultDividendSelectionPrinciples(),indices:[],stocks:[{code:stock.code,name:stock.name,checks:[{rule:'roe',status:'unknown',reason:'missing',period:'2025-12-31'}],status:'unknown',sources:[],issues:[],financial:{code:stock.code,asOf:'2026-10-31',financialSector:true,latest:{reportDate:'2026-09-30',roeBps:500},periods:[{reportDate:'2026-09-30',roeBps:500}]}}]}},now);
const config={protocol:'openai',baseUrl:'http://localhost:11434/v1',model:'stub',apiKey:'synthetic-key'};
const fcf='自由现金流通常指经营活动现金流减去资本性支出。它帮助理解经营产生的现金在维持必要投资后还剩多少。';
const simple='自由现金流就像经营收到的钱在扣掉必要设备投入后留下的余钱。这里解释现金的来去与结余。';
const roe='缺少可核对的完整年度财务口径时，这项指标不能用于可靠比较。季度累计数据不能直接充当全年结果。';
const envelope=blocks=>JSON.stringify({version:1,blocks});
const cases=[['knownLocal','什么是股息率？',envelope([{type:'concept',text:'股息率是每股现金分红除以股价的比值。'}])],['freeCashFlow','什么是自由现金流',envelope([{type:'concept',text:fcf}])],['example','举一个股息率计算例子',envelope([{type:'example',formula:'cash_yield',inputs:[0.5,10]}])],['roe','根据已有资料解释ROE为什么待核实',envelope([{type:'evidence',factIds:['stock:601398:check:roe','stock:601398:financial:roe_basis'],text:roe}])],['followup','换个简单说法',envelope([{type:'concept',text:simple}])]];
const results=[];let fcfAnswer='';
for(const[label,question,body]of cases){let calls=0;const history=label==='followup'?[{role:'user',content:'什么是自由现金流'},{role:'assistant',content:fcfAnswer}]:[];try{const ans=await askDividendAdvisorWithActions(config,ctx,question,history,{language:'zh',transport:async()=>{calls++;return{status:200,data:{choices:[{message:{content:body}}]}};}});results.push({label,question,modelCalls:calls,answer:ans.answer,actions:ans.actions});if(label==='freeCashFlow')fcfAnswer=ans.answer;}catch(error){results.push({label,question,modelCalls:calls,error:error.code??error.message});}}
for(const[label,cfg,question,transport]of [['unconfiguredLocal',null,'什么是股息率？',async()=>{throw Error('UNEXPECTED_CALL');}],['failedRoe',config,'根据已有资料解释ROE为什么待核实',async()=>({status:503,data:'PRIVATE_STUB_FAILURE'})]]){let local='';try{const ans=await askDividendAdvisorWithActions(cfg,ctx,question,[],{language:'zh',transport,onLocalResult:x=>{local=x.answer;}});results.push({label,question,localDeliveredBeforeAI:!!local,answer:ans.answer,actions:ans.actions});}catch(error){results.push({label,question,localDeliveredBeforeAI:!!local,error:error.code??error.message});}}
console.log(JSON.stringify({environment:'Read-only synthetic context, fake-indexeddb and local transport stub; no external model or real user data',results},null,2));
