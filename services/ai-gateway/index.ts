/**
 * BLOFY AI Gateway v1: isolated shared backend for future BLOFY apps.
 * Authentication: first-party STREAM bearer verified with activation service.
 * Only the entered search phrase reaches the selected AI provider (Groq or
 * Gemini); NEVER subscriber credentials, server URLs, film playlists or
 * watch-history data. The backend owns keys; Android clients never receive them.
 */
type AiResult = {
  intent: "actor" | "director" | "title" | "genre" | "mixed";
  person: string;
  genre: string;
  title: string;
  year: number | null;
  suggestedTitles: string[];
  confidence: "low" | "medium" | "high";
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), {
  status,
  headers: {"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"}
});
const usage = new Map<string, {started: number, n: number}>();
const memo = new Map<string, {exp: number, value: AiResult}>();
// Service-wide ceiling in addition to per-session limits; keeps usage
// predictable even if many valid subscriptions query simultaneously.
let globalWindow = Date.now();
let globalQueries = 0;
const MAX_BODY_BYTES = 1200;
const GEMINI_MODEL = (Bun.env.BLOFY_AI_MODEL || "gemini-2.5-flash").trim();
const GEMINI_KEY = Bun.env.BLOFY_LIBRARY_GEMINI_API_KEY || "";
// GROQ_API_KEY is set securely on the Railway function, never in the APK.
// Auto mode uses Groq as soon as the key is provisioned and retains the
// currently working Gemini backend until then; no outage during migration.
const GROQ_KEY = Bun.env.GROQ_API_KEY || "";
const GROQ_MODEL = (Bun.env.BLOFY_GROQ_MODEL || "openai/gpt-oss-20b").trim();
const PREFERRED_PROVIDER = (Bun.env.BLOFY_AI_PROVIDER || "auto").trim().toLowerCase();
type AiProvider = "groq" | "gemini";
function activeProvider(): AiProvider {
  if (PREFERRED_PROVIDER === "groq") return "groq";
  if (PREFERRED_PROVIDER === "gemini") return "gemini";
  return GROQ_KEY.trim() ? "groq" : "gemini";
}
const SESSION_URL = "https://blofyplayer.com/api/v1/stream/app/session";
const empty = (text = ""): AiResult => ({
  intent: "title", person: "", genre: "", title: text,
  year: null, suggestedTitles: [], confidence: "low"
});
const timeout = (ms: number) => AbortSignal.timeout(ms);
function textField(v: unknown, max = 90): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001F]/g," ").trim().slice(0,max) : "";
}
function clean(data: any, userText: string): AiResult {
  const kinds = ["actor","director","title","genre","mixed"];
  const intent = kinds.includes(data?.intent) ? data.intent : "title";
  const rawTitles = Array.isArray(data?.suggestedTitles) ? data.suggestedTitles : [];
  const titles = Array.from(new Set(rawTitles.map((x: unknown) => textField(x, 105))
    .filter((x: string) => x.length > 2 && x.length < 106))).slice(0, 12) as string[];
  const year = Number.isInteger(data?.year) && data.year >= 1900 && data.year <= 2035
    ? Number(data.year) : null;
  return {
    intent, person: textField(data?.person), genre: textField(data?.genre,35),
    title: textField(data?.title,110) || (intent === "title" ? userText : ""),
    year, suggestedTitles: titles,
    confidence: ["low","medium","high"].includes(data?.confidence) ? data.confidence : "low"
  };
}
function sweep(now: number) {
  if (memo.size > 600) {
    for (const [key,v] of memo) if (v.exp <= now) memo.delete(key);
    while (memo.size > 500) memo.delete(memo.keys().next().value!);
  }
  if (usage.size > 1000) {
    for (const [key,v] of usage) if (now-v.started > 600000) usage.delete(key);
    while (usage.size > 850) usage.delete(usage.keys().next().value!);
  }
}
async function verifiedSession(token: string): Promise<boolean> {
  const result = await fetch(SESSION_URL, {
    method:"GET", headers:{authorization:`Bearer ${token}`,accept:"application/json","cache-control":"no-store"},
    signal:timeout(5500), redirect:"manual"
  });
  if (result.status !== 200) return false;
  const body = await result.json() as any;
  return body?.ok === true && body?.active === true;
}
async function interpret(text: string, language: string): Promise<AiResult> {
  const provider = activeProvider();
  const prompt = [
    "You are BLOFY catalog search intent parser. Output JSON only.",
    "You DO NOT have access to the user's catalog, cannot claim an item is available.",
    "Extract one user intent, person name, broad genre, optional year and title.",
    "For queries by a well-known actor/director, supply up to 12 widely known real",
    "film or series ORIGINAL TITLES where you are confident the person participated.",
    "Never invent titles. For less-known names or ambiguous queries use empty suggestedTitles.",
    "For short bare personal full names e.g. 'Tom Cruise', prefer actor intent.",
    "For generic movie titles use title intent. For 'افلام توم كروز' prefer actor.",
    "Do not output commentary, markdown, web URLs, PII or streaming links.",
    "JSON fields: intent one of actor/director/title/genre/mixed;",
    "person string, genre string, title string, year integer or null;",
    "suggestedTitles array of strings, confidence low/medium/high.",
    `Language: ${language}.`
  ].join("\n");

  if (provider === "groq") {
    if (!GROQ_KEY.trim() || !/^[a-z0-9_./-]{5,90}$/i.test(GROQ_MODEL))
      throw Error("gateway_not_configured");
    // Groq OpenAI-compatible Chat Completions API. JSON object mode is
    // supported by GPT-OSS 20B and remains compatible with other Groq models.
    // Parse and enforce output types regardless of LLM claims.
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", redirect: "manual", signal: timeout(8500),
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {role: "system", content: prompt},
          {role: "user", content: text}
        ],
        temperature: 0.1,
        max_completion_tokens: 1024,
        response_format: {type: "json_object"},
        stream: false
      })
    });
    if (!response.ok) throw Error(`model_http_${response.status}`);
    const body = await response.json() as any;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim() || content.length > 16000)
      throw Error("empty_model_content");
    return clean(JSON.parse(content), text);
  }

  if (!GEMINI_KEY || !/^[a-z0-9_.-]{5,70}$/i.test(GEMINI_MODEL))
    throw Error("gateway_not_configured");
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`, {
    method:"POST", redirect:"manual",signal:timeout(9000),
    headers:{"content-type":"application/json","x-goog-api-key":GEMINI_KEY},
    body:JSON.stringify({
      contents:[{role:"user",parts:[{text:`${prompt}\nSearch: ${text}`}]}],
      generationConfig:{
        temperature:0.1,maxOutputTokens:1150,responseMimeType:"application/json",
        responseJsonSchema:{
          type:"object",properties:{
            intent:{type:"string"},person:{type:"string"},genre:{type:"string"},
            title:{type:"string"},year:{type:["integer","null"]},
            suggestedTitles:{type:"array",items:{type:"string"}},
            confidence:{type:"string"}
          },required:["intent","person","genre","title","year","suggestedTitles","confidence"]
        }
      }
    })
  });
  if (!response.ok) throw Error(`model_http_${response.status}`);
  const body = await response.json() as any;
  const content = body?.candidates?.[0]?.content?.parts
    ?.map((p:any)=>p?.text || "").join("") || "";
  if (!content || content.length > 16000) throw Error("empty_model_content");
  return clean(JSON.parse(content),text);
}
Bun.serve({
  port:Number(Bun.env.PORT)||3000,
  async fetch(req:Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/health") return json({
      ok:true, service:"blofy-ai", version:2, provider:activeProvider()
    });
    if (url.pathname !== "/v1/search/interpret") return json({ok:false,error:"not_found"},404);
    if (req.method !== "POST") return json({ok:false,error:"method_not_allowed"},405);
    const ct = req.headers.get("content-type") || "";
    const size = Number(req.headers.get("content-length")||0);
    if (!ct.includes("application/json") || size>MAX_BODY_BYTES) return json({ok:false,error:"invalid_body"},400);
    const auth = req.headers.get("authorization")||"";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!/^v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) return json({ok:false,error:"unauthorized"},401);
    let data:any;
    try { const raw=await req.text(); if (raw.length>MAX_BODY_BYTES) return json({ok:false,error:"too_long"},413); data=JSON.parse(raw); }
    catch { return json({ok:false,error:"invalid_json"},400); }
    const text = textField(data?.text,160), locale = data?.locale === "en" ? "en" : "ar";
    if (text.length < 2) return json({ok:false,error:"invalid_query"},400);
    try { if (!await verifiedSession(token)) return json({ok:false,error:"unauthorized"},401); }
    catch { return json({ok:false,error:"auth_unavailable"},503); }
    const now = Date.now();
    const id=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token))))
      .slice(0,16).map(b=>b.toString(16).padStart(2,"0")).join("");
    const key=id+":"+locale+":"+text.toLowerCase();
    const cached=memo.get(key);
    if(cached && cached.exp>now) return json({ok:true,source:"cache",...cached.value});
    const count=usage.get(id);
    const rate = count && now-count.started<600000 ? count : {started:now,n:0};
    if (now - globalWindow >= 600000) { globalWindow=now; globalQueries=0; }
    if(rate.n>=18 || globalQueries>=120) return json({ok:false,error:"rate_limited"},429);
    rate.n++;globalQueries++;usage.set(id,rate);sweep(now);
    try {
      const result = await interpret(text,locale);
      memo.set(key,{exp:now+15*60*1000,value:result});
      return json({ok:true,source:activeProvider(),...result});
    } catch(e) {
      // No provider request/response body, token, search or key in logs.
      const category = e instanceof Error && e.message==="gateway_not_configured" ? "not_configured" : "model_unavailable";
      return json({ok:false,error:category},503);
    }
  }
});