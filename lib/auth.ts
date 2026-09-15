import { z } from 'zod';
import { ApiError, body, checkOrigin, cookieToken, db, fail, hashToken, owner, session } from './storage';
import { harnessRequest } from './harness-client';
import type { Identity, Session } from './auth-types';
export const sessionDuration=2592000000;
const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
export function publicIdentity(current:Session):Identity {
  return {kind:current.kind,ownerId:current.ownerId,name:current.name,expiresAt:current.expiresAt,...(current.userId?{userId:current.userId,email:current.email}:{})};
}
function cookie(request:Request,name:string,value:string,expiresAt:number) {
  return `${name}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.max(0,Math.floor((expiresAt-Date.now())/1000))}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
}
function response(request:Request,identity:Identity,token:string,backup?:{token:string;expiresAt:number}|null) {
  const headers=new Headers({'Content-Type':'application/json','Cache-Control':'no-store'});
  headers.append('Set-Cookie',cookie(request,'atmos_session',token,identity.expiresAt));
  if(backup!==undefined)headers.append('Set-Cookie',cookie(request,'atmos_guest_session',backup?.token||'',backup?.expiresAt||0));
  return new Response(JSON.stringify(identity),{headers});
}
export async function newGuest(request:Request,name='创作者',clearBackup=false) {
  const ownerId=randomToken(),token=randomToken(),now=Date.now(),expiresAt=now+sessionDuration;
  await db().batch([
    db().prepare('INSERT INTO owners (id,created_at) VALUES (?,?)').bind(ownerId,now),
    db().prepare('INSERT INTO sessions (id,name,created_at,owner_id,user_id,expires_at) VALUES (?,?,?,?,NULL,?)').bind(await hashToken(token),name,now,ownerId,expiresAt),
  ]);
  return response(request,{kind:'guest',ownerId,name,expiresAt},token,clearBackup?null:undefined);
}
export async function initializeSession(request:Request) {
  try {
    checkOrigin(request);
    try { return Response.json(publicIdentity(await session(request)),{headers:{'Cache-Control':'no-store'}}); }
    catch(error){if(!(error instanceof ApiError)||error.status!==401)throw error;}
    // An expired account session can still return to a valid, unclaimed guest space.
    try {const guest=await session(request,'atmos_guest_session');if(guest.kind==='guest')return response(request,publicIdentity(guest),cookieToken(request,'atmos_guest_session')!,null);}
    catch(error){if(!(error instanceof ApiError)||error.status!==401)throw error;}
    const input=await body(request,2000),name=typeof input.name==='string'?input.name.trim().slice(0,30)||'创作者':'创作者';
    return newGuest(request,name,true);
  } catch(error){return fail(error);}
}
const password=z.string().refine(s=>Array.from(s).length>=15&&Array.from(s).length<=128,'密码须为 15–128 个字符。');
const email=z.string().trim().toLowerCase().email('请输入有效邮箱。').max(254);
const registerSchema=z.object({name:z.string().trim().min(1,'请填写昵称。').max(30),email,password,confirmPassword:z.string()}).refine(v=>v.password===v.confirmPassword,'两次密码不一致。');
const loginSchema=z.object({email,password:z.string().min(1).refine(s=>Array.from(s).length<=128)});
const changeSchema=z.object({oldPassword:z.string().min(1).refine(s=>Array.from(s).length<=128),password,confirmPassword:z.string()}).refine(v=>v.password===v.confirmPassword,'两次密码不一致。');
async function passwordCall(input:object) {
  const r=await harnessRequest('/auth/password',input);
  if(!r.ok)throw new ApiError(r.status===429?'密码服务繁忙，请稍后重试。':'密码服务暂不可用。',r.status===429?429:503);
  return await r.json() as {hash?:string;valid?:boolean};
}
async function throttle(key:string) {
  const id=await hashToken(key),now=Date.now();
  const row=await db().prepare(`INSERT INTO auth_attempts (id,hits,expires_at) VALUES (?,1,?) ON CONFLICT(id) DO UPDATE SET hits=CASE WHEN expires_at<=? THEN 1 ELSE hits+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING hits`).bind(id,now+900000,now,now,now+900000).first<{hits:number}>();
  if(!row||row.hits>10)throw new ApiError('尝试次数过多，请 15 分钟后重试。',429);
}
async function withIdentityLock<T>(ownerId:string,fn:()=>Promise<T>) {
  const r=await harnessRequest('/auth/lock',{owner:ownerId});
  if(!r.ok)throw new ApiError(r.status===409?'请先停止正在运行的任务或等待账户操作完成。':'暂时无法切换身份。',r.status===409?409:503);
  const {lease}=await r.json() as {lease:string};
  try{return await fn();}finally{await harnessRequest('/auth/unlock',{owner:ownerId,lease}).catch(()=>{});}
}
export async function authAction(request:Request,action:'register'|'login'|'logout'|'password') {
  try {
    checkOrigin(request);await owner(request);const current=await session(request);
    const input=await body(request,4000);
    return await withIdentityLock(current.ownerId,async()=>{
      // Recheck after acquiring the lock: another request may have rotated this session.
      const fresh=await session(request);if(fresh.sessionId!==current.sessionId)throw new ApiError('会话已变更，请重试。',409);
      if(action==='logout') {
        await db().prepare('DELETE FROM sessions WHERE id=?').bind(current.sessionId).run();
        try {const guest=await session(request,'atmos_guest_session');if(guest.kind==='guest')return response(request,publicIdentity(guest),cookieToken(request,'atmos_guest_session')!,null);}
        catch(error){if(!(error instanceof ApiError)||error.status!==401)throw error;}
        return newGuest(request,'创作者',true);
      }
      if(action==='password') {
        if(!current.userId)throw new ApiError('请先登录账户。',401);
        const parsed=changeSchema.safeParse(input);if(!parsed.success)throw new ApiError(parsed.error.issues[0].message);
        await throttle('password:'+current.userId);
        const user=await db().prepare('SELECT password_hash FROM users WHERE id=?').bind(current.userId).first<{password_hash:string}>();
        if(!user||!(await passwordCall({action:'verify',password:parsed.data.oldPassword,hash:user.password_hash})).valid)throw new ApiError('旧密码不正确。',400);
        const hash=(await passwordCall({action:'hash',password:parsed.data.password})).hash!;
        const token=randomToken(),now=Date.now(),expiresAt=now+sessionDuration;
        const saved=await db().batch([
          db().prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=? AND EXISTS (SELECT 1 FROM sessions WHERE id=? AND expires_at>?)').bind(hash,current.userId,user.password_hash,current.sessionId,now),
          db().prepare('DELETE FROM sessions WHERE user_id=? AND EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(current.userId,current.userId,hash),
          db().prepare('INSERT INTO sessions (id,name,created_at,owner_id,user_id,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(await hashToken(token),current.name,now,current.ownerId,current.userId,expiresAt,current.userId,hash),
        ]);
        if(!saved[0].meta.changes)throw new ApiError('账户已更新，请重新登录。',409);
        return response(request,{...publicIdentity(current),expiresAt},token);
      }
      if(current.kind==='account')throw new ApiError('请先退出当前账户。',409);
      if(action==='register') {
        const parsed=registerSchema.safeParse(input);if(!parsed.success)throw new ApiError(parsed.error.issues[0].message);
        const data=parsed.data;await throttle('register:'+data.email);
        if(await db().prepare('SELECT id FROM users WHERE email=?').bind(data.email).first())throw new ApiError('该邮箱已注册，请登录。',409);
        const hash=(await passwordCall({action:'hash',password:data.password})).hash!;
        const id=crypto.randomUUID(),token=randomToken(),now=Date.now(),expiresAt=now+sessionDuration;
        let saved;
        try { saved=await db().batch([
          db().prepare('INSERT INTO users (id,owner_id,email,name,password_hash,created_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM sessions WHERE id=? AND user_id IS NULL AND expires_at>?)').bind(id,current.ownerId,data.email,data.name,hash,now,current.sessionId,now),
          db().prepare('DELETE FROM sessions WHERE owner_id=? AND EXISTS (SELECT 1 FROM users WHERE id=?)').bind(current.ownerId,id),
          db().prepare('INSERT INTO sessions (id,name,created_at,owner_id,user_id,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=?)').bind(await hashToken(token),data.name,now,current.ownerId,id,expiresAt,id),
        ]); } catch(error){if(/UNIQUE constraint failed/.test((error as Error).message))throw new ApiError('邮箱或访客空间已被注册，请刷新后登录。',409);throw error;}
        if(!saved[0].meta.changes)throw new ApiError('访客会话已失效，请刷新。',409);
        return response(request,{kind:'account',ownerId:current.ownerId,userId:id,name:data.name,email:data.email,expiresAt},token,null);
      }
      const parsed=loginSchema.safeParse(input);if(!parsed.success)throw new ApiError('请输入有效邮箱和密码。');
      const data=parsed.data;await throttle('login:'+data.email);
      const user=await db().prepare('SELECT * FROM users WHERE email=?').bind(data.email).first<{id:string;owner_id:string;name:string;email:string;password_hash:string}>();
      const valid=(await passwordCall({action:'verify',password:data.password,hash:user?.password_hash})).valid;
      if(!user||!valid)throw new ApiError('邮箱或密码错误。',401);
      const token=randomToken(),now=Date.now(),expiresAt=now+sessionDuration;
      const inserted=await db().prepare('INSERT INTO sessions (id,name,created_at,owner_id,user_id,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM users WHERE id=? AND password_hash=?)').bind(await hashToken(token),user.name,now,user.owner_id,user.id,expiresAt,user.id,user.password_hash).run();
      if(!inserted.meta.changes)throw new ApiError('账户已更新，请重试登录。',409);
      return response(request,{kind:'account',ownerId:user.owner_id,userId:user.id,name:user.name,email:user.email,expiresAt},token,{token:cookieToken(request)!,expiresAt:current.expiresAt});
    });
  } catch(error){return fail(error);}
}
