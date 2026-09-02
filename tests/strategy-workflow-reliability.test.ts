import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path: string) => fs.readFileSync(path, 'utf8');

test('strategy detail and builder use the canonical profile workflow for back, edit, and duplicate actions', () => {
  const detail = read('components/StrategyDetailPage.tsx');
  assert.match(detail, /Back to Strategies/);
  assert.match(detail, /Edit strategy/);
  assert.match(detail, /Duplicate/);
  assert.match(detail, /handleBackToStrategies/);
  assert.match(detail, /handleEditStrategy/);
  assert.match(detail, /handleDuplicateStrategy/);
  assert.match(detail, /window\.location\.assign\(`\/profile\?strategy=\$\{encodeURIComponent\(strategy\.id\)\}&mode=edit`\)/);
  assert.match(detail, /window\.location\.assign\(`\/profile\?strategy=\$\{encodeURIComponent\(strategy\.id\)\}&mode=duplicate`\)/);

  const builder = read('components/StrategyBuilder.tsx');
  assert.match(builder, /const selectedStrategyId = searchParams\.get\('strategy'\);/);
  assert.match(builder, /const requestedMode = searchParams\.get\('mode'\);/);
  assert.match(builder, /if \(requestedMode === 'duplicate'\)/);
  assert.match(builder, /if \(requestedMode === 'edit'\)/);
  assert.match(builder, /const hydrated = await openProfile\(target\)/);
  assert.match(builder, /openV2Edit\(hydrated\.profile, hydrated\.rules, hydrated\.sessions\)/);
  assert.match(builder, /requestOpenProfile\(item\)/);
});

test('builder and validate route gate access to a real saved strategy before launching check-a-setup', () => {
  const builder = read('components/StrategyBuilder.tsx');
  const validatePage = read('app/validate/page.tsx');
  const saveRoute = read('app/api/strategies/save/route.ts');
  const strategyName = read('lib/strategy-name.ts');

  assert.ok(builder.includes('const canUsePersistedValidation = Boolean(profile.id);'));
  assert.ok(builder.includes("href={`/validate?strategy=${encodeURIComponent(profile.id)}`}>{w('Check a setup')}</a>"));
  assert.ok(builder.includes('const nameError=validateStrategyName(saveProfile.name); if (nameError) {setMessage(nameError);return false;}'));
  assert.ok(builder.includes("if(!result.strategyId||result.saved!==true||!result.strategy||result.strategy.id!==result.strategyId||typeof result.strategy.name!=='string'||!result.strategy.name.trim())throw new Error('Strategy persistence response was incomplete.');"));
  assert.ok(builder.includes('const savedProfile:StrategyProfile={...normalized,...saveProfile,id:result.strategyId'));
  assert.ok(saveRoute.includes("const nameError = typeof value.name === 'string' ? validateStrategyName(value.name) : 'Strategy name is required.'"));
  assert.ok(strategyName.includes("if (!name) return 'Strategy name is required.'"));
  assert.ok(validatePage.includes('const params = await searchParams;'));
  assert.ok(validatePage.includes('const strategyId = params.strategy?.trim();'));
  assert.ok(validatePage.includes('strategy = strategyId ? await loadStrategyById(supabase, user.id, strategyId) : await loadActiveStrategy(supabase, user.id);'));
  assert.ok(validatePage.includes('c.notFound'));
  assert.ok(validatePage.includes('StrategyNotFoundError'));
});

test('final review name validation blocks persistence before API save and keeps v2 parent save lifecycle intact', () => {
  const builder = read('components/StrategyBuilder.tsx');
  const saveRoute = read('app/api/strategies/save/route.ts');
  const v2 = read('components/StrategyBuilderV2.tsx');

  assert.ok(builder.includes('const finalReviewNameError=validateStrategyName(profile.name);'));
  assert.ok(builder.includes('const nameError=validateStrategyName(saveProfile.name); if (nameError) {setMessage(nameError);return false;}'));
  assert.ok(builder.includes('if (!saveProfile.id && nameError) { setMessage(nameError); return false; }'));
  assert.ok(saveRoute.includes("const nameError = typeof value.name === 'string' ? validateStrategyName(value.name) : 'Strategy name is required.'"));

  assert.ok(v2.includes('onApply: (persisted: V2Persisted) => Promise<boolean> | boolean'));
  assert.ok(v2.includes('const persisted = v2StateToPersistedStrategy(profile, currentState());'));
  assert.ok(v2.includes('await onApply(persisted);'));
  assert.ok(builder.includes('function handleV2Apply(persisted: V2Persisted): Promise<boolean> {'));
  assert.ok(builder.includes('setProfile(persisted.profile);'));
  assert.ok(builder.includes('setRules(persisted.rules);'));
  assert.ok(builder.includes('setSessions(persisted.sessions);'));
  assert.ok(builder.includes("setBuilderStep('review');"));
});

test('approve and save in strategy builder V2 goes through the parent persisted save lifecycle', () => {
  const v2 = read('components/StrategyBuilderV2.tsx');
  const builder = read('components/StrategyBuilder.tsx');

  assert.ok(v2.includes('onApply: (persisted: V2Persisted) => Promise<boolean> | boolean'));
  assert.ok(v2.includes('const persisted = v2StateToPersistedStrategy(profile, currentState());'));
  assert.ok(v2.includes('await onApply(persisted);'));
  assert.ok(v2.includes('disabled={!approvalConfirmed || saving}'));
  assert.ok(v2.includes('Saving…'));
  assert.ok(!v2.includes("fetch('/api/strategies/save'"));

  assert.ok(builder.includes('function handleV2Apply(persisted: V2Persisted): Promise<boolean> {'));
  assert.ok(builder.includes('setProfile(persisted.profile);'));
  assert.ok(builder.includes('setRules(persisted.rules);'));
  assert.ok(builder.includes('setSessions(persisted.sessions);'));
  assert.ok(builder.includes('setV2EntryOpen(false);'));
  assert.ok(builder.includes("setBuilderStep('review');"));
  assert.ok(builder.includes('const nameError=validateStrategyName(saveProfile.name); if (nameError) {setMessage(nameError);return false;}'));
  assert.ok(builder.includes('const savedProfile:StrategyProfile={...normalized,...saveProfile,id:result.strategyId'));
});

test('backtesting run button opens the configuration flow instead of becoming a no-op', () => {
  const detail = read('components/StrategyDetailPage.tsx');

  assert.match(detail, /function openBacktestForm\(\)\s*\{\s*setTab\('backtests'\);\s*setFormOpen\(true\);\s*\}/s);
  assert.match(detail, /onClick=\{openBacktestForm\}/);
  assert.match(detail, /formOpen && \(/);
  assert.ok(detail.includes('run_id'));
  assert.ok(detail.includes("fetch('/api/backtests',"));
});

test('strategy detail tabs keep a single full-width layout contract', () => {
  const detail = read('components/StrategyDetailPage.tsx');
  const stylesheet = read('app/trade-police.css');

  assert.match(detail, /strategy-detail-panel/);
  assert.match(detail, /strategy-detail-tab-panel/);
  assert.match(detail, /strategy-detail-section-card/);
  assert.match(stylesheet, /\.strategy-detail-panel\{[^}]*width:\s*100%/);
  assert.match(stylesheet, /\.strategy-detail-tab-panel\{[^}]*width:\s*100%/);
  assert.match(stylesheet, /\.strategy-detail-section-card\{[^}]*width:\s*100%/);
  assert.match(detail, /card strategy-detail-panel/);
  assert.match(detail, /strategy-detail-view/);
  assert.match(stylesheet, /\.strategy-detail-panel\.card\{[^}]*height:\s*clamp\(/);
});

test('completion success card keeps a resilient responsive container and title layout', () => {
  const component = read('components/StrategyLearningConfirmation.tsx');
  const stylesheet = read('app/trade-police.css');

  assert.match(component, /strategy-complete-card/);
  assert.match(component, /strategy-complete-hero/);
  assert.match(stylesheet, /\.strategy-complete-card\{[^}]*width:\s*min\(100%/);
  assert.match(stylesheet, /\.strategy-complete-hero\{[^}]*min-width:\s*0/);
  assert.match(stylesheet, /overflow-wrap:\s*anywhere|word-break:\s*break-word/);
});
