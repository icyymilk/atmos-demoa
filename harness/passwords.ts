import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
const N=131072,r=8,p=1;
let active=0;
export class PasswordBusy extends Error {}
export async function passwordOperation(input:{action:'hash'|'verify';password:string;hash?:string}) {
  if(active>=2)throw new PasswordBusy('密码服务繁忙，请稍后重试。');
  if(typeof input.password!=='string'||Array.from(input.password).length>128)throw new Error('密码格式无效。');
  active++;
  try {
    const match=input.hash?.match(/^scrypt\$131072\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/);
    const salt=input.action==='hash'?randomBytes(16).toString('hex'):match?.[1]||'0'.repeat(32);
    const derived=await new Promise<Buffer>((resolve,reject)=>scrypt(input.password,Buffer.from(salt,'hex'),64,{N,r,p,maxmem:192*1024*1024},(error,key)=>error?reject(error):resolve(key)));
    if(input.action==='hash')return {hash:`scrypt$${N}$${r}$${p}$${salt}$${derived.toString('hex')}`};
    const equal=timingSafeEqual(derived,Buffer.from(match?.[2]||'0'.repeat(128),'hex'));
    return {valid:!!match&&equal};
  } finally {active--;}
}
