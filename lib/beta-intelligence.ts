'use client';

export const BETA_EVENT_TYPES=['ONBOARDING_STARTED','ONBOARDING_COMPLETED','PLAYBOOK_CREATED','PLAYBOOK_UPDATED','PLAYBOOK_DUPLICATED','PLAYBOOK_ARCHIVED','PLAYBOOK_RESTORED','PLAYBOOK_DELETED','METHODOLOGY_CONFIRMED','METHODOLOGY_REJECTED','SIMULATION_APPROVED','SIMULATION_REJECTED','FIRST_ANALYSIS_STARTED','FIRST_ANALYSIS_COMPLETED','ANALYSIS_COMPLETED','ANALYSIS_ABANDONED'] as const;
export type BetaEventType=typeof BETA_EVENT_TYPES[number];

function sessionId(){
  const key='trade-police-beta-session-id';
  let value=window.sessionStorage.getItem(key);
  if(!value){value=crypto.randomUUID();window.sessionStorage.setItem(key,value)}
  return value;
}

function platform(){
  const agent=navigator.userAgent.toLowerCase();
  if(/ipad|tablet/.test(agent))return 'TABLET';
  if(/android|iphone|mobile/.test(agent))return 'MOBILE';
  return 'DESKTOP';
}

export function trackBetaEvent(eventType:BetaEventType,playbookId?:string|null){
  const body=JSON.stringify({eventType,playbookId:playbookId??null,platform:platform(),sessionId:sessionId()});
  return fetch('/api/beta-intelligence/events',{method:'POST',headers:{'Content-Type':'application/json'},body,keepalive:true}).then(()=>undefined).catch(()=>undefined);
}

export function trackBetaEventOnce(eventType:BetaEventType,playbookId?:string|null){
  const key=`trade-police-beta-once:${eventType}:${playbookId??'none'}`;
  if(window.sessionStorage.getItem(key))return Promise.resolve();
  window.sessionStorage.setItem(key,'true');
  return trackBetaEvent(eventType,playbookId);
}
