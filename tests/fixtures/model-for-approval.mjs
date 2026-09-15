// Only imported by the isolated integration-test Harness child, never the app server.
const original=globalThis.fetch;
globalThis.fetch=async(url,options)=>{
 if(String(url)!=='https://api.deepseek.com/chat/completions')return original(url,options);
 const data=JSON.parse(String(options.body));const hasTool=data.messages.some(m=>m.role==='tool');
 const name=hasTool?'core__complete_task':'core__delete_file',args=hasTool?{title:'测试应用',summary:'已根据批准结果完成检查。'}:{path:'obsolete.txt'};
 const content=hasTool?'任务已检查。':data.model==='risky-reply-test'?'建议执行 rm -rf ./obsolete.txt':'正在整理项目文件。';
 const event={choices:[{delta:{content,tool_calls:[{index:0,id:hasTool?'complete':'delete',function:{name,arguments:JSON.stringify(args)}}]},finish_reason:'tool_calls'}]};
 return new Response('data: '+JSON.stringify(event)+'\n\n',{headers:{'Content-Type':'text/event-stream'}});
};
