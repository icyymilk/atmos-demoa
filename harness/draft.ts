import type { ToolCall } from './model';
import type { Draft } from '../lib/live-workspace';
// Parse only top-level JSON string fields. A partial final string is display-only;
// never repair/execute JSON. Escaped quotes, newlines and split Unicode are handled.
export function partialStrings(raw:string):Record<string,string>{
  const fields:Record<string,string>=Object.create(null);let i=0;
  const ws=()=>{while(/\s/.test(raw[i]||'!'))i++;};
  function str():{text:string;complete:boolean}|undefined{
    if(raw[i++]!=='"')return;let text='';
    while(i<raw.length){const c=raw[i++];if(c==='"')return{text,complete:true};if(c==='\\'){
      if(i>=raw.length)return{text,complete:false};const e=raw[i++];
      if(e==='u'){const hex=raw.slice(i,i+4);if(!/^[a-fA-F0-9]{4}$/.test(hex))return{text,complete:false};text+=String.fromCharCode(parseInt(hex,16));i+=4;}
      else {const escapes:Record<string,string>={'"':'"','\\':'\\','/':'/','n':'\n','r':'\r','t':'\t','b':'\b','f':'\f'};if(!(e in escapes))return; text+=escapes[e];}
    }else{if(c<' ')return;text+=c;}}
    return{text,complete:false};
  }
  ws();if(raw[i++]!=='{')return fields;
  while(i<raw.length){ws();if(raw[i]==='}')break;const key=str();if(!key?.complete)return fields;ws();if(raw[i++]!==':')return fields;ws();
    if(raw[i]==='"'){const value=str();if(!value)return fields;if(value.complete||['content','new_text'].includes(key.text))fields[key.text]=value.text;if(!value.complete)return fields;}
    else{const scalar=raw.slice(i).match(/^(?:-?\d+(?:\.\d+)?|true|false|null)/);if(!scalar)return fields;i+=scalar[0].length;}
    ws();if(raw[i++]!==',')break;
  }
  return fields;
}
export function draftFromCall(call:ToolCall,iteration:number):Draft|undefined{
  const operations:Record<string,Draft['operation']>={core__write_file:'write',core__append_file:'append',core__edit_file:'edit'};
  const operation=operations[call.function.name];if(!operation)return;
  const fields=partialStrings(call.function.arguments),name=fields.path;
  if(!name||name.length>180||name.startsWith('/')||name.includes('\\')||name.split('/').some(x=>!x||x==='.'||x==='..'))return;
  return{id:`${iteration}:${call.id}`,path:name,operation,text:(fields[operation==='edit'?'new_text':'content']||'').slice(0,180000),status:'generating'};
}
