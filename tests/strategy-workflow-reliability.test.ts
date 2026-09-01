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
  assert.ok(builder.includes('href={`/validate?strategy=${encodeURIComponent(profile.id)}`}>Check a setup</a>') || builder.includes('href={`/validate?strategy=${encodeURIComponent(profile.id)}`}>Check a setup</a>'));
  assert.ok(builder.includes('const nameError=validateStrategyName(saveProfile.name); if (nameError) {setMessage(nameError);return false;}'));
  assert.ok(builder.includes("if(!result.strategyId||result.saved!==true||!result.strategy||result.strategy.id!==result.strategyId||typeof result.strategy.name!=='string'||!result.strategy.name.trim())throw new Error('Strategy persistence response was incomplete.');"));
  assert.ok(builder.includes('const savedProfile:StrategyProfile={...normalized,...saveProfile,id:result.strategyId'));
  assert.ok(saveRoute.includes("const nameError = typeof value.name === 'string' ? validateStrategyName(value.name) : 'Strategy name is required.'"));
  assert.ok(strategyName.includes("if (!name) return 'Strategy name is required.'"));
  assert.ok(validatePage.includes('const params = await searchParams;'));
  assert.ok(validatePage.includes('const strategyId = params.strategy?.trim();'));
  assert.ok(validatePage.includes('strategy = strategyId ? await loadStrategyById(supabase, user.id, strategyId) : await loadActiveStrategy(supabase, user.id);'));
  assert.ok(validatePage.includes('Saved strategy not found'));
  assert.ok(validatePage.includes('StrategyNotFoundError'));
});

test('final review explains why save is disabled when the strategy name is invalid', () => {
  const builder = read('components/StrategyBuilder.tsx');

  assert.match(builder, /const saveDisabledReason = finalReviewNameError \? 'Name your strategy before saving\.' : !finalReview\.canSave \? finalReview\.statusDetail \|\| 'This strategy is not ready to save yet\.' : null;/);
  assert.match(builder, /id="save-disabled-reason"/);
  assert.match(builder, /aria-describedby=\{saveDisabledReason \? 'save-disabled-reason' : undefined\}/);
  assert.match(builder, /Name your strategy before saving\./);
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
