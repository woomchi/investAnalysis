import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(ROOT, '.env');
try {
  const raw = await readFile(envFile, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
} catch {}

const PORT = Number(process.env.PORT || 3000);
const MODE = (process.env.DATA_MODE || 'live').toLowerCase();
const SEC_UA = process.env.SEC_USER_AGENT;
const TOSS_ID = process.env.TOSS_CLIENT_ID;
const TOSS_SECRET = process.env.TOSS_CLIENT_SECRET;
console.log(JSON.stringify({scope:'stockscore-api',event:'module_loaded',runtime:process.version,mode:MODE,providers:{sec:true,toss:Boolean(TOSS_ID&&TOSS_SECRET)}}));
const cache = new Map();
let tickerMapCache;
let tossToken;
let tossTokenExpires = 0;
const json = (res, status, body) => { const data=JSON.stringify(body); res.writeHead(status, {'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(data),'cache-control':'no-store','access-control-allow-origin':'*'}); res.end(data); };
const makeTrace = requestId => (event, details={}) => console.log(JSON.stringify({scope:'stockscore-api',requestId,event,...details}));
async function fetchWithTrace(provider,url,options={},trace){
  const target=new URL(url),started=Date.now();
  trace?.('provider_request_started',{provider,target:`${target.hostname}${target.pathname}`});
  try{
    const response=await fetch(url,options);
    trace?.('provider_response_received',{provider,target:`${target.hostname}${target.pathname}`,status:response.status,durationMs:Date.now()-started});
    return response;
  }catch(error){
    trace?.('provider_request_failed',{provider,target:`${target.hostname}${target.pathname}`,durationMs:Date.now()-started,errorName:error.name,errorMessage:error.message});
    throw error;
  }
}
const finite = x => x===null||x===undefined||x===''?null:(Number.isFinite(Number(x))?Number(x):null);
function fromFacts(facts, names, unit='USD') {
  for (const name of names) {
    const entry=facts?.[name]; if (!entry) continue;
    const rows=entry.units?.[unit] || Object.values(entry.units||{}).flat();
    const usable=rows.filter(x=>x.form==='10-K'||x.form==='10-Q').sort((a,b)=>String(b.end).localeCompare(String(a.end)));
    if (usable.length) return usable[0];
  }
  return null;
}
async function secJson(url,trace) {
  const r=await fetchWithTrace('sec',url,{headers:{'User-Agent':SEC_UA,'Accept-Encoding':'gzip, deflate','Accept':'application/json'}},trace);
  if(!r.ok) throw new Error(`SEC returned HTTP ${r.status}`);
  return r.json();
}
async function getTickerMap(trace) {
  if(tickerMapCache) return tickerMapCache;
  const data=await secJson('https://www.sec.gov/files/company_tickers.json',trace);
  tickerMapCache=new Map(Object.values(data).map(x=>[String(x.ticker).toUpperCase(),String(x.cik_str).padStart(10,'0')]));
  return tickerMapCache;
}
async function getTossToken(trace) {
  if(tossToken && Date.now()<tossTokenExpires-60000) return tossToken;
  const form=new URLSearchParams({grant_type:'client_credentials',client_id:TOSS_ID,client_secret:TOSS_SECRET});
  const r=await fetchWithTrace('toss-token','https://openapi.tossinvest.com/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form},trace);
  const data=await r.json();
  if(!r.ok||!data.access_token) throw new Error(`Toss token request failed (HTTP ${r.status})`);
  tossToken=data.access_token;tossTokenExpires=Date.now()+(Number(data.expires_in||86400)*1000);return tossToken;
}
async function tossPrice(ticker,trace) {
  const token=await getTossToken(trace);
  const url=new URL('https://openapi.tossinvest.com/api/v1/prices');url.searchParams.set('symbols',ticker);
  const r=await fetchWithTrace('toss-price',url,{headers:{Authorization:`Bearer ${token}`}},trace);
  const data=await r.json();
  if(!r.ok) throw new Error(`Toss prices request failed (HTTP ${r.status})`);
  const row=(data.result||[]).find(x=>String(x.symbol).toUpperCase()===ticker);
  if(!row) throw new Error(`Toss returned no price for ${ticker}`);
  return {price:finite(row.lastPrice),currency:row.currency||'USD',timestamp:row.timestamp};
}
function latestAnnual(facts,names) { const f=fromFacts(facts,names);return f?finite(f.val):null; }
async function liveAnalysis(ticker,trace) {
  if(cache.has(ticker)&&Date.now()-cache.get(ticker).at<15*60*1000) return cache.get(ticker).value;
  const tickers=await getTickerMap(trace),cik=tickers.get(ticker);if(!cik) throw Object.assign(new Error(`SEC has no company mapping for ${ticker}.`),{status:404});
  const [sub,factsDoc,priceData]=await Promise.all([
    secJson(`https://data.sec.gov/submissions/CIK${cik}.json`,trace),
    secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,trace),
    TOSS_ID&&TOSS_SECRET ? tossPrice(ticker,trace) : Promise.resolve(null)
  ]);
  const facts=factsDoc.facts?.['us-gaap']||{};
  const revenue=fromFacts(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']);
  const operating=fromFacts(facts,['OperatingIncomeLoss']);
  const cfo=fromFacts(facts,['NetCashProvidedByUsedInOperatingActivities']);
  const capex=fromFacts(facts,['PaymentsToAcquirePropertyPlantAndEquipment']);
  const debt=fromFacts(facts,['LongTermDebtAndFinanceLeaseObligationsCurrent','LongTermDebtCurrent']);
  const longDebt=fromFacts(facts,['LongTermDebtAndFinanceLeaseObligations','LongTermDebtNoncurrent']);
  const equity=fromFacts(facts,['StockholdersEquity']);
  const netIncome=fromFacts(facts,['NetIncomeLoss']);
  const shares=fromFacts(factsDoc.facts?.dei||{},['EntityCommonStockSharesOutstanding'],'shares');
  const latestRev=finite(revenue?.val), latestOp=finite(operating?.val), latestCfo=finite(cfo?.val), latestCapex=finite(capex?.val), latestIncome=finite(netIncome?.val), sharesOutstanding=finite(shares?.val);
  let growth=null;
  if(revenue){const previous=(revenue.units?.[revenue.uom]||[]).filter(x=>x.form===revenue.form&&x.end<revenue.end&&Math.abs(new Date(revenue.end)-new Date(x.end))>300*864e5).sort((a,b)=>String(b.end).localeCompare(String(a.end)))[0];if(previous&&finite(previous.val)!==0)growth=(latestRev/Number(previous.val)-1)*100;}
  const opMargin=latestRev&&latestOp!==null?latestOp/latestRev*100:null;
  const fcf=latestCfo!==null&&latestCapex!==null&&latestRev?((latestCfo-Math.abs(latestCapex))/latestRev)*100:null;
  const liabilities=(finite(debt?.val)||0)+(finite(longDebt?.val)||0), equityValue=finite(equity?.val);
  const debtRatio=equityValue&&equityValue>0?liabilities/equityValue*100:null;
  const company=sub?.name||ticker;
  const marketCap=priceData?.price&&sharesOutstanding?priceData.price*sharesOutstanding:null;
  const periodsPerYear=revenue?.form==='10-Q'?4:1;
  const earningsForValuation=latestIncome!==null?latestIncome*periodsPerYear:null;
  const salesForValuation=latestRev!==null?latestRev*periodsPerYear:null;
  const valuation=marketCap&&earningsForValuation>0?marketCap/earningsForValuation:marketCap&&salesForValuation>0?marketCap/salesForValuation:null;
  const valuationBasis=marketCap&&earningsForValuation>0?'approx. annualized P/E':marketCap&&salesForValuation>0?'approx. annualized P/S':null;
  const out={ticker,name:company,sector:'US listed · SEC filing',price:priceData?.price??null,currency:priceData?.currency||'USD',priceAsOf:priceData?.timestamp||null,growth,margin:opMargin,fcf,debt:debtRatio,valuation,valuationBasis,model:null,moat:null,risk:null,source:priceData?'SEC Company Facts + Toss prices':'SEC Company Facts (Toss credentials not configured)',asOf:revenue?.end||null,raw:{revenue:latestRev,operatingIncome:latestOp,operatingCashFlow:latestCfo,capitalExpenditures:latestCapex,totalDebt:liabilities,equity:equityValue,netIncome:latestIncome,sharesOutstanding,marketCap}};
  cache.set(ticker,{at:Date.now(),value:out});return out;
}
function score(metrics,weights,cutoff=75){const keys=['growth','margin','fcf','debt','valuation'];const w=weights||{growth:25,margin:25,fcf:20,debt:15,valuation:15};const total=keys.reduce((n,k)=>n+(Number(w[k])||0),0);if(total!==100)throw Object.assign(new Error('Weights must sum to 100.'),{status:400});const parts={growth:Math.min(100,Math.max(0,(metrics.growth??0)*.7+25)),margin:Math.min(100,(metrics.margin??0)*1.45),fcf:Math.min(100,(metrics.fcf??0)*1.55),debt:Math.max(0,100-(metrics.debt??100)*1.35),valuation:Math.max(0,100-(metrics.valuation??100)*1.55)};const totalScore=Math.round(keys.reduce((n,k)=>n+parts[k]*Number(w[k]),0)/100);return {score:totalScore,parts,passed:totalScore>=Number(cutoff),cutoff};}
async function serveFile(res){const html=await readFile(path.join(ROOT,'index.html'));res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-length':Buffer.byteLength(html)});res.end(html);}
export async function handleApi(req,res,url=new URL(req.url,'http://localhost'),context={}){
  const requestId=context.requestId||randomUUID(),trace=context.trace||makeTrace(requestId),started=context.started||Date.now();
  const reply=(status,body)=>{trace('request_completed',{status,durationMs:Date.now()-started});res.setHeader('x-request-id',requestId);return json(res,status,status>=400?{...body,requestId}:body);};
  if(req.method==='OPTIONS'){trace('request_completed',{status:204,durationMs:Date.now()-started});res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','x-request-id':requestId});return res.end();}
  let stage='routing';
  try{
    if(req.method==='GET'&&url.pathname==='/api/health')return reply(200,{ok:true,mode:MODE,providers:{sec:'available (no API key)',toss:Boolean(TOSS_ID&&TOSS_SECRET)},message:TOSS_ID&&TOSS_SECRET?'Live SEC and Toss data enabled.':'SEC data enabled; Toss credentials missing, so price and valuation may be unavailable.'});
    if(req.method==='GET'&&url.pathname.startsWith('/api/analysis/')){const ticker=decodeURIComponent(url.pathname.split('/').pop()).toUpperCase();trace('analysis_started',{ticker});if(!/^[A-Z.]{1,5}$/.test(ticker))return reply(400,{error:'Ticker must contain 1–5 letters or dots.'});stage='live_analysis';const data=await liveAnalysis(ticker,trace);return reply(200,data);}
    if(req.method==='POST'&&url.pathname==='/api/score'){stage='score';let body='';for await(const chunk of req){body+=chunk;if(body.length>100000)throw Object.assign(new Error('Request too large.'),{status:413});}const input=JSON.parse(body||'{}');return reply(200,score(input.metrics||{},input.weights,input.cutoff));}
    return reply(404,{error:'Not found'});
  }catch(e){trace('request_failed',{stage,status:e.status||502,errorName:e.name||'Error',errorMessage:e.message||'Unknown error',stack:e.stack});return reply(e.status||502,{error:e.message||'Upstream request failed.'});}
}
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const incomingId=req.headers['x-vercel-id']||req.headers['x-request-id'];
  const requestId=typeof incomingId==='string'&&/^[\w.:-]{1,120}$/.test(incomingId)?incomingId:randomUUID();
  const trace=makeTrace(requestId),started=Date.now();
  trace('request_started',{method:req.method,path:url.pathname});
  if(url.pathname.startsWith('/api/'))return handleApi(req,res,url,{requestId,trace,started});
  if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){
    try{res.setHeader('x-request-id',requestId);await serveFile(res);trace('request_completed',{status:200,durationMs:Date.now()-started});return;}
    catch(e){trace('request_failed',{stage:'serve_index',status:500,errorName:e.name||'Error',errorMessage:e.message||'Unknown error',stack:e.stack});return json(res,500,{error:'Failed to load application page.',requestId});}
  }
  trace('request_completed',{status:404,durationMs:Date.now()-started});
  res.setHeader('x-request-id',requestId);
  return json(res,404,{error:'Not found',requestId});
});
server.listen(PORT,()=>console.log(JSON.stringify({scope:'stockscore-api',event:'server_listening',port:PORT,mode:MODE})));

