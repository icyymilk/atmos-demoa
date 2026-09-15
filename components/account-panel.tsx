'use client';
import { useState } from 'react';
import { ArrowUpRight, Loader2, ShieldCheck } from 'lucide-react';
import type { Identity } from '@/lib/auth-types';
export function AccountPanel({identity,busy,onChanged,beforeChange}:{identity:Identity;busy:boolean;onChanged:(identity:Identity)=>void;beforeChange:()=>Promise<void>}) {
  const [mode,setMode]=useState<'login'|'register'|'password'>(identity.kind==='account'?'password':'register');
  const [name,setName]=useState(identity.name),[email,setEmail]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[oldPassword,setOldPassword]=useState('');
  const [pending,setPending]=useState(false),[error,setError]=useState('');
  function switchMode(next:typeof mode){setMode(next);setError('');setPassword('');setConfirm('');setOldPassword('');}
  async function submit(action:typeof mode|'logout') {
    if(busy||pending)return;
    setPending(true);setError('');
    try {
      await beforeChange();
      const data=action==='logout'?{}:action==='password'?{oldPassword,password,confirmPassword:confirm}:action==='register'?{name,email,password,confirmPassword:confirm}:{email,password};
      const response=await fetch('/api/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Atmos-Owner':identity.ownerId},body:JSON.stringify(data)});
      const result=await response.json() as Identity&{error?:string};
      if(!response.ok)throw new Error(result.error||'账户操作失败，请重试。');
      setPassword('');setConfirm('');setOldPassword('');onChanged(result);
    }catch(error){setError((error as Error).message);}finally{setPending(false);}
  }
  return <section className="account-panel">
    {identity.kind==='guest'?<><p className="account-intro">把灵感，留在你的账户里。</p><div className="account-tabs"><button className={mode==='register'?'active':''} onClick={()=>switchMode('register')} disabled={pending}>创建账户</button><button className={mode==='login'?'active':''} onClick={()=>switchMode('login')} disabled={pending}>登录</button></div></>:<div className="account-summary"><span className="avatar">{identity.name.slice(0,1)}</span><div><strong>{identity.name}</strong><p>{identity.email}</p></div><span>已登录</span></div>}
    <div className="account-notice"><ShieldCheck size={16}/><p>{identity.kind==='account'?'项目和外部连接保存在当前服务的账户空间中。':'注册后继承当前访客的项目和外部连接。登录已有账户时，访客资料将单独保留，退出后可返回。'}</p></div>
    {busy&&<p role="status" className="connection-result failure">请先停止正在运行的任务，再切换账户或修改密码。</p>}
    {error&&<p role="alert" className="connection-result failure">{error}</p>}
    <form onSubmit={e=>{e.preventDefault();void submit(mode);}}>
      <fieldset disabled={pending||busy}>
        {mode==='register'&&<label>昵称<input name="name" autoComplete="nickname" required maxLength={30} value={name} onChange={e=>setName(e.target.value)}/></label>}
        {mode!=='password'&&<label>邮箱<input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="you@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label>}
        {mode==='password'&&<label>当前密码<input name="oldPassword" type="password" autoComplete="current-password" required maxLength={256} value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label>}
        <label>{mode==='password'?'新密码':'密码'}<input name="password" type="password" autoComplete={mode==='login'?'current-password':'new-password'} required maxLength={256} placeholder={mode==='login'?'输入你的密码':'15–128 个字符，支持空格和中文'} value={password} onChange={e=>setPassword(e.target.value)}/></label>
        {mode!=='login'&&<label>确认密码<input name="confirmPassword" type="password" autoComplete="new-password" required maxLength={256} value={confirm} onChange={e=>setConfirm(e.target.value)}/></label>}
        <button className="primary-button full-width" type="submit">{pending?<Loader2 className="spin" size={16}/>:<ArrowUpRight size={16}/>} {pending?'正在处理…':mode==='register'?'注册并保留我的项目':mode==='login'?'登录我的账户':'修改密码'}</button>
      </fieldset>
    </form>
    {identity.kind==='account'&&<button className="secondary-button full-width account-logout" disabled={busy||pending} onClick={()=>void submit('logout')}>退出登录</button>}
    <p className="account-footnote">{mode==='password'?'修改密码后，其他浏览器的登录将失效。 ':''}邮箱目前仅作为登录名，尚未验证；暂不提供邮件找回密码，请妥善保存密码。</p>
  </section>;
}
