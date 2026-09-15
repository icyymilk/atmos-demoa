/** A configured public origin supports a TLS reverse proxy without trusting client-supplied forwarding headers. */
export function requestOrigin(request:Request,configured?:string){
  if(!configured)return new URL(request.url).origin;
  const url=new URL(configured);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Invalid ATMOS_PUBLIC_ORIGIN');
  return url.origin;
}
export function allowedOrigin(request:Request,configured?:string){
  const origin=request.headers.get('origin');
  return request.headers.get('sec-fetch-site')!=='cross-site'&&(!origin||origin===requestOrigin(request,configured));
}
