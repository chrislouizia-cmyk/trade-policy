export const STRATEGY_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type DiagnosticStrategy={id:string;name:string;customer?:{id:string;name:string|null};state?:'ACTIVE'|'INACTIVE'|'ARCHIVED';instruments?:readonly string[];category?:string|null;engineVersion?:number|null;health?:{state:string}};
export function strategyOptionLabel(item:DiagnosticStrategy){
  const context=[item.customer?.name,item.state,item.instruments?.[0]||item.category,item.engineVersion?`Engine v${item.engineVersion}`:null].filter(Boolean);
  return `${item.name}${context.length?` — ${context.join(' · ')}`:''}`;
}
