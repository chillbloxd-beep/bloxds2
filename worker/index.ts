interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANON_HASH_SALT: string;
  TURNSTILE_SECRET_KEY?: string;
  ALLOWED_ORIGIN?: string;
}

type CommunityRunInput = {
  id: string;
  game: string;
  implementation?: string;
  gameDataVersion: string;
  phase: string;
  miningType: string;
  startCounter: number;
  endCounter: number;
  durationMs: number;
  source: string;
  tool?: string;
  breakSpeed?: string;
  momentum?: string;
  device?: string;
  turnstileToken?: string;
};

const durationBuckets = ["<5m","5–15m","15–30m","30–60m","1–3h","3–6h","6h+"];
const allowedSources = ["manual","live_timer","afk_timer"];
const COMMUNITY_SAMPLE_LIMIT = 10_000;

function bucket(ms:number) {
  const min=ms/60000;
  if(min<5)return "<5m"; if(min<15)return "5–15m"; if(min<30)return "15–30m";
  if(min<60)return "30–60m"; if(min<180)return "1–3h"; if(min<360)return "3–6h"; return "6h+";
}

function json(data: unknown, status=200, origin?:string|null) {
  const headers:Record<string,string>={"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
  if(origin){headers["access-control-allow-origin"]=origin;headers["vary"]="Origin";}
  return new Response(JSON.stringify(data),{status,headers});
}

function corsOrigin(req:Request,env:Env):string|null {
  const incoming=req.headers.get("origin");
  if(!incoming)return "";
  const requestOrigin=new URL(req.url).origin;
  if(incoming===requestOrigin)return incoming;
  if(env.ALLOWED_ORIGIN && incoming===env.ALLOWED_ORIGIN)return incoming;
  return null;
}

function hasStrongSalt(env:Env){
  return typeof env.ANON_HASH_SALT==="string" && env.ANON_HASH_SALT.length>=32;
}

async function hashInstallId(id:string,salt:string){
  const bytes=new TextEncoder().encode(`${salt}:${id}`);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

function quantile(values:number[],p:number){
  if(!values.length)return null;
  const sorted=[...values].sort((a,b)=>a-b);
  const i=(sorted.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i),w=i-lo;
  return lo===hi?sorted[lo]:sorted[lo]*(1-w)+sorted[hi]*w;
}

function median(values:number[]){return quantile(values,.5)}

function robustFilter<T extends {average_bps:number}>(rows:T[]){
  if(rows.length<30)return {included:rows,excluded:0};
  const rates=rows.map(r=>r.average_bps), med=median(rates)!;
  const deviations=rates.map(v=>Math.abs(v-med));
  const mad=median(deviations)??0;
  if(mad===0)return {included:rows,excluded:0};
  const limit=6*1.4826*mad;
  const included=rows.filter(r=>Math.abs(r.average_bps-med)<=limit);
  return {included,excluded:rows.length-included.length};
}

async function verifyTurnstile(token:string|undefined,req:Request,env:Env){
  if(!env.TURNSTILE_SECRET_KEY)return true;
  if(!token)return false;
  const form=new FormData();
  form.set("secret",env.TURNSTILE_SECRET_KEY);
  form.set("response",token);
  const ip=req.headers.get("CF-Connecting-IP");
  if(ip)form.set("remoteip",ip);
  const res=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{method:"POST",body:form});
  if(!res.ok)return false;
  const data=await res.json() as {success?:boolean};
  return data.success===true;
}

function validOptionalText(value:unknown,max=120){
  return value===undefined || (typeof value==="string" && value.length<=max);
}

function validateRun(x:CommunityRunInput){
  if(!x||typeof x!=="object")return "Invalid payload";
  if(typeof x.id!=="string"||x.id.length<1||x.id.length>100)return "Invalid run id";
  if(!["bloxd","minecraft"].includes(x.game))return "Unsupported game";
  if(!["active","afk"].includes(x.miningType))return "Invalid mining type";
  if(!allowedSources.includes(x.source))return "Invalid run source";
  if(!Number.isSafeInteger(x.startCounter)||!Number.isSafeInteger(x.endCounter)||x.startCounter<0||x.endCounter<=x.startCounter)return "Invalid counters";
  if(!Number.isFinite(x.durationMs)||x.durationMs<=0||x.durationMs>31*24*3600*1000)return "Invalid duration";
  if(typeof x.phase!=="string"||x.phase.trim().length<1||x.phase.length>80)return "Invalid phase";
  if(typeof x.gameDataVersion!=="string"||x.gameDataVersion.length<1||x.gameDataVersion.length>40)return "Invalid game data version";
  if(!validOptionalText(x.implementation,100)||!validOptionalText(x.tool)||!validOptionalText(x.breakSpeed,80)||!validOptionalText(x.momentum,80)||!validOptionalText(x.device))return "Run metadata too long or invalid";
  return null;
}

async function insertRun(req:Request,env:Env,origin:string|null){
  if(!hasStrongSalt(env))return json({error:"Community storage is not configured"},503,origin);
  const declaredLength=Number(req.headers.get("content-length")||0);
  if(Number.isFinite(declaredLength)&&declaredLength>16_384)return json({error:"Payload too large"},413,origin);

  let body:CommunityRunInput;
  try{body=await req.json()}catch{return json({error:"Invalid JSON"},400,origin)}
  const error=validateRun(body); if(error)return json({error},400,origin);
  if(!(await verifyTurnstile(body.turnstileToken,req,env)))return json({error:"Human verification failed"},403,origin);

  const install=req.headers.get("x-install-id");
  if(!install||install.length<20||install.length>300)return json({error:"Missing anonymous install identifier"},400,origin);

  const blocks=body.endCounter-body.startCounter;
  const averageBps=blocks/(body.durationMs/1000);
  if(!Number.isFinite(averageBps)||averageBps<=0||averageBps>1000)return json({error:"Derived rate outside sanity bounds"},400,origin);

  const quality=(blocks>=1000||body.durationMs>=300000)?"included":"short_sample";
  const playerHash=await hashInstallId(install,env.ANON_HASH_SALT);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO community_runs
    (id, player_hash, game, implementation, game_data_version, phase, mining_type, start_counter, end_counter, blocks_mined, duration_ms, average_bps, duration_bucket, source, tool, break_speed, momentum, device, quality_state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    body.id,playerHash,body.game,body.implementation??null,body.gameDataVersion,body.phase.trim(),body.miningType,
    body.startCounter,body.endCounter,blocks,Math.round(body.durationMs),averageBps,bucket(body.durationMs),
    body.source,body.tool??null,body.breakSpeed??null,body.momentum??null,body.device??null,quality,new Date().toISOString()
  ).run();

  return json({ok:true,id:body.id,blocksMined:blocks,averageBps,qualityState:quality},201,origin);
}

async function deleteRun(req:Request,env:Env,origin:string|null,id:string){
  if(!hasStrongSalt(env))return json({error:"Community storage is not configured"},503,origin);
  if(!id||id.length>100)return json({error:"Invalid run id"},400,origin);
  const install=req.headers.get("x-install-id");
  if(!install||install.length<20||install.length>300)return json({error:"Missing anonymous install identifier"},400,origin);
  const playerHash=await hashInstallId(install,env.ANON_HASH_SALT);
  await env.DB.prepare("DELETE FROM community_runs WHERE id = ? AND player_hash = ?").bind(id,playerHash).run();
  return new Response(null,{status:204,headers:origin?{"access-control-allow-origin":origin,"vary":"Origin"}:{}});
}

async function summary(req:Request,env:Env,origin:string|null){
  const url=new URL(req.url);
  const game=url.searchParams.get("game")||"bloxd";
  const phase=url.searchParams.get("phase");
  const miningType=url.searchParams.get("miningType");
  const durationBucket=url.searchParams.get("durationBucket");
  if(!["bloxd","minecraft"].includes(game))return json({error:"Unsupported game"},400,origin);
  if(phase && phase.length>80)return json({error:"Invalid phase"},400,origin);
  if(miningType && !["active","afk"].includes(miningType))return json({error:"Invalid mining type"},400,origin);
  if(durationBucket&&!durationBuckets.includes(durationBucket))return json({error:"Invalid duration bucket"},400,origin);

  const where=["game = ?","quality_state = 'included'"];
  const binds:(string|number)[]=[game];
  if(phase){where.push("phase = ?");binds.push(phase)}
  if(miningType){where.push("mining_type = ?");binds.push(miningType)}
  if(durationBucket){where.push("duration_bucket = ?");binds.push(durationBucket)}

  const sql=`SELECT player_hash, blocks_mined, duration_ms, average_bps FROM community_runs WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ${COMMUNITY_SAMPLE_LIMIT+1}`;
  const result=await env.DB.prepare(sql).bind(...binds).all<{player_hash:string;blocks_mined:number;duration_ms:number;average_bps:number}>();
  const rawRows=result.results??[];
  const sampleCapped=rawRows.length>COMMUNITY_SAMPLE_LIMIT;
  const rows=rawRows.slice(0,COMMUNITY_SAMPLE_LIMIT);
  const {included,excluded}=robustFilter(rows);
  const rates=included.map(r=>r.average_bps);
  const blocks=included.map(r=>r.blocks_mined);
  const durations=included.map(r=>r.duration_ms);
  const totalBlocks=blocks.reduce((a,b)=>a+b,0);
  const totalDurationMs=durations.reduce((a,b)=>a+b,0);
  const mean=(vals:number[])=>vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;

  return json({
    scope:{game,phase:phase||undefined,miningType:miningType||undefined,durationBucket:durationBucket||undefined},
    runs:included.length,
    players:new Set(included.map(r=>r.player_hash)).size,
    totalBlocks,totalDurationMs,
    combinedThroughput:totalDurationMs?totalBlocks/(totalDurationMs/1000):null,
    meanSessionRate:mean(rates),medianSessionRate:median(rates),
    p10:quantile(rates,.10),p25:quantile(rates,.25),p75:quantile(rates,.75),p90:quantile(rates,.90),
    averageBlocksPerRun:mean(blocks),medianBlocksPerRun:median(blocks),
    averageDurationMs:mean(durations),medianDurationMs:median(durations),
    excludedOutliers:excluded,
    sampleCapped,
    sampleLimit:COMMUNITY_SAMPLE_LIMIT
  },200,origin);
}

export default {
  async fetch(req:Request,env:Env):Promise<Response>{
    const url=new URL(req.url);
    const incomingOrigin=req.headers.get("origin");
    const origin=corsOrigin(req,env);

    if(url.pathname.startsWith("/api/") && incomingOrigin && origin===null){
      return json({error:"Origin not allowed"},403);
    }

    if(req.method==="OPTIONS"){
      if(!origin)return new Response(null,{status:403});
      return new Response(null,{status:204,headers:{
        "access-control-allow-origin":origin,
        "access-control-allow-methods":"GET,POST,DELETE,OPTIONS",
        "access-control-allow-headers":"content-type,x-install-id",
        "access-control-max-age":"86400","vary":"Origin"
      }});
    }

    if(url.pathname==="/api/health")return json({ok:true,service:"oneblock-analytics"},200,origin);
    if(url.pathname==="/api/community/runs"&&req.method==="POST")return insertRun(req,env,origin);
    const deleteMatch=url.pathname.match(/^\/api\/community\/runs\/([^/]+)$/);
    if(deleteMatch&&req.method==="DELETE")return deleteRun(req,env,origin,decodeURIComponent(deleteMatch[1]));
    if(url.pathname==="/api/community/summary"&&req.method==="GET")return summary(req,env,origin);
    if(url.pathname.startsWith("/api/"))return json({error:"Not found"},404,origin);
    return env.ASSETS.fetch(req);
  }
};
