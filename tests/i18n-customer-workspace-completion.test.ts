import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { workspaceText } from '../lib/i18n/workspace-copy.ts';
import { translate } from '../lib/i18n/messages.ts';

const root=process.cwd();
const read=(file:string)=>fs.readFileSync(path.join(root,file),'utf8');

test('dashboard, strategy creation, and trading accounts have Spanish and French copy',()=>{
  assert.equal(workspaceText('es','Make the next decision with your rules in view.'),'Toma la siguiente decisión con tus reglas a la vista.');
  assert.equal(workspaceText('fr','Create Strategy'),'Créer une stratégie');
  assert.equal(workspaceText('es','Add trading account'),'Agregar cuenta de trading');
  assert.equal(workspaceText('fr','No broker login or password is required. This account is used for risk, history, and analytics inside Trade Police.'),'Aucun identifiant ni mot de passe du broker n’est requis. Ce compte sert au risque, à l’historique et aux analyses dans Trade Police.');
});

test('trading accounts are permanently discoverable after onboarding',()=>{
  const header=read('components/AppHeader.tsx');
  const account=read('app/account/page.tsx');
  const accounts=read('components/TradingAccounts.tsx');
  assert.equal(translate('es','nav.tradingAccounts'),'Cuentas de trading');
  assert.match(header,/href="\/accounts">\{t\('nav\.tradingAccounts'\)\}/);
  const navigationOrder=['/dashboard','/validate','/active-trade','/accounts','/profile','/history','/analytics','/account'];
  navigationOrder.slice(1).forEach((href,index)=>assert.ok(header.indexOf(`href="${navigationOrder[index]}"`)<header.indexOf(`href="${href}"`)));
  assert.match(account,/href="\/accounts"/);
  assert.match(accounts,/Add another account whenever you need one/);
  assert.match(accounts,/No broker login or password is required/);
  assert.doesNotMatch(accounts,/broker password|broker credentials|master password/i);
});

test('strategy builder localizes the internal creation paths and steps',()=>{
  const builder=read('components/StrategyBuilderV2.tsx');
  assert.match(builder,/w\('Build visually'\)/);
  assert.match(builder,/w\('Describe your strategy — Beta'\)/);
  assert.match(builder,/w\('Step 5 — Review & Activate'\)/);
  assert.match(builder,/w\('Approve & Apply'\)/);
});
