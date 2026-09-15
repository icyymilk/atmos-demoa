import { authAction } from '@/lib/auth';
export function POST(request:Request){return authAction(request,'login');}
