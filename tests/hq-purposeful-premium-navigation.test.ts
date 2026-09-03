import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(path:string)=>fs.readFileSync(path,'utf8');

test('HQ navigation is permission-scoped and grouped into compact disclosures',()=>{
  const nav=read('components/hq/HQNav.tsx');
  for(const group of ['Command','People & company','Growth','Trust & operations']) assert.match(nav,new RegExp(group.replace('&','\\&')));
  assert.match(nav,/navigationGroups\.map/);
  assert.match(nav,/<details className="hq-command-group"/);
  assert.match(nav,/permissions\.includes\(permission\)/);
  assert.doesNotMatch(nav,/hq-desktop-nav|hq-mobile-nav|primaryMobileLabels/);
});

test('HQ navigation keeps one disclosure open and dismisses it predictably',()=>{
  const nav=read('components/hq/HQNav.tsx');
  assert.match(nav,/const \[openGroup,setOpenGroup\]=useState<string\|null>\(null\)/);
  assert.match(nav,/document\.addEventListener\('pointerdown',closeFromOutside\)/);
  assert.match(nav,/event\.key==='Escape'/);
  assert.match(nav,/setOpenGroup\(expanded\?null:group\.label\)/);
  assert.doesNotMatch(nav,/open=\{active \|\| undefined\}/);
});

test('executive cards expose verified values and a real destination',()=>{
  const dashboard=read('components/admin/AdminDashboard.tsx');
  assert.match(dashboard,/typeof metric\.value==='number'/);
  assert.match(dashboard,/module\.metrics\.filter/);
  assert.match(dashboard,/<details className="hq-module-card"/);
  assert.doesNotMatch(dashboard,/label: "Authorizations today"[\s\S]{0,100}value: undefined/);
  assert.doesNotMatch(dashboard,/label: "Trades blocked today"[\s\S]{0,100}value: undefined/);
});

test('Company does not fabricate integration health or obsolete pricing',()=>{
  const company=read('app/hq/organizations/page.tsx');
  assert.match(company,/Open System Operations/);
  assert.match(company,/does not infer or fabricate provider health/);
  assert.match(company,/Free · Pro · Elite · Team/);
  assert.doesNotMatch(company,/Pro \$10|Premium \$20|<Status name=|<small>Connected<\/small>/);
});

test('HQ premium layer covers department workspaces and responsive navigation',()=>{
  const layout=read('app/layout.tsx');
  const css=read('app/hq-premium.css');
  assert.match(layout,/hq-premium\.css/);
  for(const selector of ['customer-directory-page','team-workspace','sales-v2','compliance-v2','system-operations','feedback-queue','private-beta-queue']) assert.match(css,new RegExp(selector));
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});

test('executive mobile overview caps incident previews and links the full queue',()=>{
  const page=read('app/hq/page.tsx');
  const dashboard=read('components/admin/AdminDashboard.tsx');
  const css=read('app/hq-premium.css');
  assert.match(page,/admin_recent_incidents'.*p_limit:16/);
  assert.match(dashboard,/openIncidents\.slice\(0, 8\)/);
  assert.match(dashboard,/View full incident queue/);
  assert.match(css,/\.hq-condensed-list-footer/);
  assert.match(css,/\.hq-executive-card \.event-row\{display:grid/);
});
