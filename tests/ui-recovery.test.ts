import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

function source(path:string){
  return readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
}

test('dashboard completion uses account, active strategy, and prior market analysis',()=>{
  const page=source('app/page.tsx');
  const dashboard=source('components/Dashboard.tsx');

  assert.match(page,/from\('market_scans'\).*count:'exact'.*head:true/);
  assert.match(page,/hasTrade=\{\(analysisCount\?\?0\)>0\}/);
  assert.match(dashboard,/setupComplete=Boolean\(p\.account&&p\.strategy&&p\.hasTrade\)/);
  assert.match(dashboard,/\{!setupComplete&&<OnboardingChecklist/);
});

test('dashboard checklist remains available while setup is incomplete',()=>{
  const dashboard=source('components/Dashboard.tsx');

  assert.match(dashboard,/hasAccount=\{Boolean\(p\.account\)\}/);
  assert.match(dashboard,/hasStrategy=\{Boolean\(p\.strategy\)\}/);
  assert.match(dashboard,/hasTrade=\{p\.hasTrade\}/);
});

test('Validate retains the two-column decision rail around the Sprint workspace',()=>{
  const validator=source('components/TradeValidator.tsx');

  assert.match(validator,/className="validate-workspace-grid"/);
  assert.match(validator,/className="decision-workspace-column"/);
  assert.match(validator,/className="decision-workspace-sticky"/);
  assert.match(validator,/className="card primary-workspace-surface trade-workspace"/);
  assert.match(validator,/manualConfirmations=confirmationList\(manualEvidence\)/);
  assert.match(validator,/ManualConfirmationDrawer/);
});

test('Rule Builder retains all Sprint A rule controls',()=>{
  const builder=source('components/RuleBuilder.tsx');

  assert.match(builder,/>Weight</);
  assert.match(builder,/>Confidence</);
  assert.match(builder,/>Mandatory</);
  assert.match(builder,/>Automatic</);
  assert.match(builder,/>Manual</);
  assert.match(builder,/evaluationMode/);
});

test('responsive styles contain Validate, rule rows, and the decision modal',()=>{
  const css=source('app/trade-police.css');

  assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.validate-workspace-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css,/\.sprint-rule-table\s*\{[\s\S]*?overflow-x:\s*auto/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*?\.sprint-rule-table \.rule-table-row\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(css,/\.reasoning-modal\s*\{[\s\S]*?max-width:\s*100%[\s\S]*?box-sizing:\s*border-box/);
  assert.match(css,/\.reasoning-modal-body\s*\{[\s\S]*?overflow-x:\s*hidden[\s\S]*?overscroll-behavior:\s*contain/);
});

test('Analyze narrative hierarchy is responsive and moves the answer before the form on mobile',()=>{
  const css=source('app/trade-police.css');
  const validator=source('components/TradeValidator.tsx');

  assert.match(validator,/className="card primary-workspace-surface decision-report-workspace narrative-workspace"/);
  assert.match(validator,/>Why\?</);
  assert.match(validator,/>What is missing\?</);
  assert.match(validator,/>What should I do next\?</);
  assert.ok(validator.indexOf('className="card mobile-decision-answer"')<validator.indexOf('className="card primary-workspace-surface trade-workspace"'));
  assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.mobile-decision-answer\s*\{[\s\S]*?grid-row:\s*1/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*?\.decision-workspace-column\s*\{[\s\S]*?grid-row:\s*3/);
  assert.match(css,/@media\(max-width:640px\)[\s\S]*?\.narrative-actions li\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/);
});
