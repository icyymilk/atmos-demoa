export type TrustMode='always'|'important'|'allow';
export type TrustSettings={mode:TrustMode;revision:number};
export const trustLabels:Record<TrustMode,string>={always:'总是询问',important:'重要询问',allow:'完全允许'};
export type ApprovalRequest={id:string;runId:string;callId?:string;subject:'tool'|'reply';name:string;input:string;reasons:string[];fingerprint:string;mode:TrustMode;expiresAt:number;status:'pending'|'approved'|'denied'|'expired'};
