import {db} from './storage';
export async function historyPage(projectId:string,before:number,limit=5){
 const result=await db().prepare('SELECT id, project_id, number, prompt, summary, mode, created_at, length(code) AS codeCharacters, CASE WHEN trace IS NOT NULL AND trace != \'[]\' THEN 1 ELSE 0 END AS hasTrace FROM versions WHERE project_id=? AND number<? ORDER BY number DESC LIMIT ?').bind(projectId,before,limit+1).all<{id:string;project_id:string;number:number;prompt:string;summary:string;mode:string;created_at:number;codeCharacters:number;hasTrace:number}>();
 const rows=result.results.slice(0,limit);return {versions:rows.reverse().map(v=>({...v,code:'',artifactLoaded:false,hasTrace:!!v.hasTrace})),before:result.results.length>limit?Number(rows[0].number):null};
}
export async function versionArtifact(projectId:string,number:number){const v=await db().prepare('SELECT * FROM versions WHERE project_id=? AND number=?').bind(projectId,number).first();return v?{...v,files:JSON.parse(String(v.files||'{}')),trace:JSON.parse(String(v.trace||'[]')),artifactLoaded:true,codeCharacters:String(v.code).length}:null;}
