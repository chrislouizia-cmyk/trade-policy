import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(file:string)=>fs.readFileSync(file,'utf8');

test('premium landing stays concise, visual, responsive, and multilingual',()=>{
  const page=read('app/page.tsx');
  const copy=read('lib/i18n/landing-copy.ts');
  const css=read('app/trade-police-landing.module.css');
  assert.match(page,/getLandingCopy\(locale\)/);
  assert.match(page,/styles\.terminal/);
  assert.match(page,/styles\.journalVisual/);
  assert.match(page,/FlowIcon/);
  assert.match(copy,/Tu estrategia, aplicada/);
  assert.match(copy,/Votre stratégie, appliquée/);
  assert.match(css,/@media\(max-width:680px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('new visitors render signup without waiting for a remote auth check',()=>{
  const login=read('app/client/login/page.tsx');
  const cookieCheck=login.indexOf('if(authCookieNames.length===0)');
  const authClient=login.indexOf('const supabase = await createClient()');
  assert.ok(cookieCheck>0);
  assert.ok(authClient>cookieCheck);
  assert.match(login,/return <LoginSurface copy=\{c\}/);
  assert.match(login,/priority\/>/);
});

test('public navigation does not wait on remote auth or expose the footer between screens',()=>{
  const proxy=read('lib/supabase/proxy.ts');
  const css=read('app/trade-police.css');
  const noCookieFastPath=proxy.indexOf('authCookieNames.length===0&&isPublic');
  const remoteAuth=proxy.indexOf('supabase.auth.getUser()');
  assert.ok(noCookieFastPath>0&&noCookieFastPath<remoteAuth);
  assert.match(css,/\.app-document-content \{[\s\S]*min-height: calc\(100dvh - 42px\)/);
  assert.doesNotMatch(css,/\.app-document-content>main:not\(\.marketing-page\)\{animation:premium-page-enter/);
});
