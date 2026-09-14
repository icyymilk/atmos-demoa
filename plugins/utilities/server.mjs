import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const server = new McpServer({name:'atmos-utilities',version:'1.0.0'});
const result = value => ({content:[{type:'text',text:JSON.stringify(value)}]});
server.registerTool('current_time',{description:'返回当前 UTC 时间和指定时区的时间。',inputSchema:{timezone:z.string().default('Asia/Shanghai')}},async({timezone})=>result({utc:new Date().toISOString(),local:new Date().toLocaleString('zh-CN',{timeZone:timezone}),timezone}));
server.registerTool('calculate',{description:'准确计算两个数字的四则运算和百分比。',inputSchema:{a:z.number(),b:z.number(),operation:z.enum(['add','subtract','multiply','divide','percent'])}},async({a,b,operation})=>{if(b===0&&['divide','percent'].includes(operation))return {...result({error:'除数不能为零'}),isError:true};return result({result:operation==='add'?a+b:operation==='subtract'?a-b:operation==='multiply'?a*b:operation==='divide'?a/b:a/b*100});});
await server.connect(new StdioServerTransport());
