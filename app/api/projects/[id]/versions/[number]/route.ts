import {ApiError,fail,getProject,owner} from '@/lib/storage';
import {versionArtifact} from '@/lib/project-history';
export async function GET(request:Request,{params}:{params:Promise<{id:string;number:string}>}){try{const {id,number}=await params;await getProject(id,await owner(request));if(!/^\d+$/.test(number))throw new ApiError('版本号无效。');const version=await versionArtifact(id,Number(number));if(!version)throw new ApiError('版本不存在。',404);return Response.json(version,{headers:{'Cache-Control':'no-store'}});}catch(e){return fail(e);}}
