'use client';

import {useEffect} from 'react';

export default function AppError({error,reset}:{error:Error&{digest?:string};reset:()=>void}){
  useEffect(()=>{console.error('[APP_ROUTE_ERROR]',{message:error.message,digest:error.digest})},[error]);
  return <main className="login-shell"><section className="card login-card"><p className="eyebrow">TEMPORARY INTERRUPTION</p><h1>This page could not be loaded</h1><p>Your trade and billing data were not changed. Check your connection, then try again.</p><button className="primary" type="button" onClick={reset}>Try again</button></section></main>;
}
