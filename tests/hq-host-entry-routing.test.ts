import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {getHQEntryDestination} from '../lib/hostname-routing.ts';

const proxy=readFileSync(new URL('../lib/supabase/proxy.ts',import.meta.url),'utf8');
const login=readFileSync(new URL('../app/hq/login/page.tsx',import.meta.url),'utf8');

test('HQ root sends unauthenticated visitors to employee login',()=>{
 assert.equal(getHQEntryDestination({pathname:'/',authenticated:false,pendingInvitation:false,workspaceRoute:null}),'/hq/login');
 assert.equal(getHQEntryDestination({pathname:'/hq',authenticated:false,pendingInvitation:false,workspaceRoute:null}),'/hq/login');
 assert.equal(getHQEntryDestination({pathname:'/hq/login',authenticated:false,pendingInvitation:false,workspaceRoute:null}),null);
});

test('pending invitations always resume HQ onboarding',()=>{
 for(const pathname of ['/','/hq','/hq/login'])assert.equal(getHQEntryDestination({pathname,authenticated:true,pendingInvitation:true,workspaceRoute:null}),'/hq/onboarding');
 assert.match(login,/current_staff_invitation_onboarding_v1[\s\S]+if \(invitation\) redirect\('\/hq\/onboarding'\)[\s\S]+staff_workspace_route/);
 assert.doesNotMatch(login,/staff_workspace_route[\s\S]+current_staff_invitation_onboarding_v1/);
});

test('active staff enter their assigned workspace without owner redirect loops',()=>{
 assert.equal(getHQEntryDestination({pathname:'/',authenticated:true,pendingInvitation:false,workspaceRoute:'/hq/sales'}),'/hq/sales');
 assert.equal(getHQEntryDestination({pathname:'/hq/login',authenticated:true,pendingInvitation:false,workspaceRoute:'/hq/system'}),'/hq/system');
 assert.equal(getHQEntryDestination({pathname:'/hq',authenticated:true,pendingInvitation:false,workspaceRoute:'/hq'}),null);
});

test('authenticated identities without staff access fail safely once',()=>{
 assert.equal(getHQEntryDestination({pathname:'/',authenticated:true,pendingInvitation:false,workspaceRoute:null}),'/hq/login?error=access');
 assert.equal(getHQEntryDestination({pathname:'/hq/login',authenticated:true,pendingInvitation:false,workspaceRoute:null}),'/hq/login?error=access');
 assert.equal(getHQEntryDestination({pathname:'/hq/login',authenticated:true,pendingInvitation:false,workspaceRoute:null,accessError:true}),null);
});

test('proxy limits staff RPC resolution to HQ entrypoints and preserves callback queries',()=>{
 assert.match(proxy,/routingDecision\.mode === 'hq' && isHQEntryPath\(pathname\)/);
 assert.match(proxy,/current_staff_invitation_onboarding_v1/);
 assert.match(proxy,/staff_workspace_route/);
 assert.match(proxy,/new URL\(`\$\{request\.nextUrl\.pathname\}\$\{request\.nextUrl\.search\}`/);
 assert.match(proxy,/pathname\.startsWith\('\/api\/hq'\)/);
});
