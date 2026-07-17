export const STRATEGY_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type DiagnosticStrategy={id:string;name:string;ownerName?:string|null;ownerEmail?:string|null;active:boolean;archived:boolean;instruments?:string[];tradingStyle?:string|null};
export function strategyOptionLabel(item:DiagnosticStrategy){
  const context=[item.ownerName||item.ownerEmail,item.active?'Active':'Inactive',item.archived?'Archived':null,item.instruments?.[0]||item.tradingStyle].filter(Boolean);
  return `${item.name}${context.length?` — ${context.join(' · ')}`:''}`;
}
