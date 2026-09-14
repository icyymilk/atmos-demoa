import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { load } from 'cheerio';
import { Agent, fetch as safeFetch } from 'undici';

export function isPrivateAddress(address: string) {
  if (address.includes(':')) return address === '::' || address === '::1' || /^f[cd]|^fe[89ab]/i.test(address) || address.includes('.') || /^::ffff:/i.test(address);
  const [a,b] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a >= 224;
}
export async function publicUrl(raw: string) {
  const url = new URL(raw);
  if (!['https:','http:'].includes(url.protocol) || url.username || url.password || url.port && !['80','443'].includes(url.port)) throw new Error('网页工具只读取普通 HTTP/HTTPS 公网地址。');
  const hostname = url.hostname.replace(/^\[|\]$/g,'');
  if (hostname === 'localhost' || hostname.endsWith('.local')) throw new Error('网页工具不访问本机或内网地址。');
  const addresses = isIP(hostname) ? [{address:hostname}] : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({address}) => isPrivateAddress(address))) throw new Error('该地址指向本机或内网，不能通过网页工具读取。');
  return url;
}
// Resolve and validate again at connection time; use those exact addresses so a
// DNS change between URL validation and socket creation cannot reach the LAN.
const publicDispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  lookup(hostname, { all: true }).then(addresses => {
    if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
      callback(new Error('网页连接目标不是公网地址。'), '', 4); return;
    }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }, error => callback(error, '', 4));
} } });
export async function readWebPage(raw: string, signal: AbortSignal) {
  let url = await publicUrl(raw), response: Awaited<ReturnType<typeof safeFetch>> | undefined;
  for (let redirects = 0; redirects < 5; redirects++) {
    response = await safeFetch(url, { dispatcher: publicDispatcher, signal, redirect: 'manual', headers: { 'User-Agent': 'AtmosResearch/1.0', Accept: 'text/html, text/plain, application/json' } });
    if (response.status >= 300 && response.status < 400) { const next = response.headers.get('location'); await response.body?.cancel(); if (!next) throw new Error('网页返回无目标的重定向。'); url = await publicUrl(new URL(next,url).href); continue; }
    break;
  }
  if (!response?.ok || !response.body) throw new Error(`网页读取失败：HTTP ${response?.status}。`);
  const mime = response.headers.get('content-type') || '';
  if (!/text|json|xml/.test(mime)) { await response.body.cancel(); throw new Error('当前网页工具支持 HTML、文本、JSON；不支持此文件类型。'); }
  const reader = response.body.getReader(); let bytes = 0; const decoder = new TextDecoder(); let rawText = '';
  try { while (true) { const {done,value}=await reader.read(); if(done)break; bytes+=value.length; if(bytes>1500000)throw new Error('网页过大，请读取更具体的页面。'); rawText+=decoder.decode(value,{stream:true}); } rawText+=decoder.decode(); } finally { await reader.cancel().catch(()=>{}); }
  const $ = load(rawText); const title = $('title').text().trim();
  $('script,style,noscript,svg,nav,footer').remove();
  const text = /html/.test(mime) ? ($('main,article').first().text() || $('body').text()).replace(/\s+/g,' ').trim() : rawText;
  const links = $('a[href]').toArray().slice(0,60).map(a=>{ try{return {title:$(a).text().trim().slice(0,100),url:new URL($(a).attr('href')!,url).href};}catch{return null;} }).filter(Boolean);
  return { url:url.href, title, text:text.slice(0,22000), truncated:text.length>22000, links };
}
