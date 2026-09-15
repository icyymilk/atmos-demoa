import {test,expect} from '@playwright/test';

test('system typography, sidebar and keyboard-accessible dialogs',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('button',{name:'配置模型',exact:true})).toBeVisible();
  expect(await page.locator('body').evaluate(e=>getComputedStyle(e).fontFamily)).toContain('-apple-system');
  await page.getByRole('button',{name:'配置模型',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'连接你的 AI 模型'})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'配置模型',exact:true})).toBeFocused();
  await page.keyboard.press('Control+,');await expect(page.getByRole('dialog',{name:'连接你的 AI 模型'})).toBeVisible();
  await page.keyboard.press('Escape');await page.keyboard.press('Control+k');await expect(page.getByRole('textbox',{name:'描述你想创建的应用'})).toBeFocused();
  await page.getByRole('button',{name:'打开导航',exact:true}).click();await expect(page.getByRole('complementary',{name:'主导航'})).toBeHidden();
  await page.getByRole('button',{name:'打开导航',exact:true}).click();await expect(page.getByRole('complementary',{name:'主导航'})).toBeVisible();
  for(const [name,title] of [['使用指南','从一个想法开始'],['信任与审批','信任与审批'],['工具与扩展','Agent 工具与扩展'],['记忆中心','记忆中心']]){
    await page.getByRole('button',{name,exact:true}).click();await expect(page.getByRole('dialog',{name:title,exact:true})).toBeVisible();await page.keyboard.press('Escape');
  }
  await page.screenshot({path:'test-results/release-home.png',animations:'disabled'});
  expect(errors).toEqual([]);
});

test('mobile navigation traps focus, closes with Escape and settings fit the viewport',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.getByRole('button',{name:'注册 / 登录',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'打开导航',exact:true}).click();
  const sidebar=page.getByRole('complementary',{name:'主导航'});await expect(sidebar).toBeVisible();
  expect(await page.locator('.main-shell').evaluate(e=>(e as HTMLElement).inert)).toBe(true);
  await page.keyboard.press('Shift+Tab');expect(await sidebar.evaluate(e=>e.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');await expect(sidebar).toBeHidden();await expect(page.getByRole('button',{name:'打开导航',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'打开导航',exact:true}).click();await page.getByRole('button',{name:'配置模型',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'连接你的 AI 模型'});await expect(dialog).toBeVisible();
  await page.getByRole('button',{name:'保存配置',exact:false}).scrollIntoViewIfNeeded();
  expect(await dialog.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})).toBe(true);
  await page.screenshot({path:'test-results/release-mobile-settings.png'});await page.keyboard.press('Escape');
  expect(await page.locator('.main-shell').evaluate(e=>(e as HTMLElement).inert)).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('template edits persist across reload, source and full ZIP work on desktop and mobile',async({page,context})=>{
  await page.goto('/');await expect(page.getByRole('button',{name:'注册 / 登录',exact:true})).toBeVisible();
  let id:string|undefined;
  try{
    await page.getByRole('button',{name:/轻量任务看板/}).click();await expect(page.getByRole('button',{name:'导出项目',exact:true})).toBeEnabled();
    id=new URL(page.url()).searchParams.get('project')||undefined;expect(id).toBeTruthy();
    const frame=page.frameLocator('iframe[title="生成应用预览"]'),task='提交验收 '+Date.now();
    await frame.getByRole('textbox',{name:'新任务'}).fill(task);await frame.getByRole('button',{name:/添加任务/}).click();
    await expect.poll(async()=>{const data=await (await context.request.get(`/api/projects/${id}`)).json();return JSON.stringify(data.state).includes(task);}).toBe(true);
    await page.reload();await expect(frame.getByText(task,{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'代码',exact:true}).click();await expect(page.getByLabel('工作区文件',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'预览',exact:true}).click();
    await page.getByRole('button',{name:'导出项目',exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'下载完整项目 ZIP',exact:true}).click();
    const download=await downloading;expect(download.suggestedFilename()).toMatch(/\.zip$/);await download.saveAs('test-results/release-project.zip');await page.keyboard.press('Escape');
    await page.screenshot({path:'test-results/release-workspace.png',animations:'disabled'});
    for(const width of [1024,768,390,360]){
      await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await expect(page.getByRole('button',{name:'导出项目',exact:true})).toBeVisible();
      if(width<=740){await page.getByRole('button',{name:'对话',exact:true}).click();await expect(page.getByRole('textbox',{name:'描述修改需求'})).toBeVisible();await page.getByRole('button',{name:'应用',exact:true}).click();}
      await expect(frame.getByText(task,{exact:true})).toBeVisible();
    }
    await page.screenshot({path:'test-results/release-mobile-workspace.png',animations:'disabled'});
  }finally{if(id)await context.request.delete(`/api/projects/${id}`);}
});
