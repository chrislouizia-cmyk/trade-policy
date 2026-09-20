import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { buildEquityDrawdownSeries, renderEquityDrawdownSvg } from '@/lib/backtesting/backtest-report-chart';
import { buildBacktestReportModel } from '@/lib/backtesting/backtest-report-model';
import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function e(value: unknown): string {
  return String(value ?? '—').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]!);
}

function date(value: unknown, includeTime = false): string {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) return e(value);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    timeZone: 'UTC',
    ...(includeTime ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : {}),
  }).format(parsed);
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'backtest';
}

function number(value: unknown, digits = 0): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
}

function metric(label: string, value: string) {
  return `<div class="metric"><span>${e(label)}</span><strong>${e(value)}</strong></div>`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

  const { id } = await params;
  const { data: run, error: runError } = await supabase.from('backtest_runs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (runError) return apiError('BACKTEST_REPORT_FAILED', 'Backtest report could not be loaded.', 500);
  if (!run) return apiError('BACKTEST_NOT_FOUND', 'Backtest run not found.', 404);
  if (run.status !== 'COMPLETED') return apiError('BACKTEST_NOT_COMPLETED', 'Only completed backtests can be reported.', 409);

  const [{ data: result, error: resultError }, { data: trades, error: tradesError }, { data: persistedCandidates, error: candidatesError }] = await Promise.all([
    supabase.from('backtest_results').select('*').eq('run_id', id).maybeSingle(),
    supabase.from('backtest_trades').select('*').eq('run_id', id).order('sequence', { ascending: true }),
    supabase.from('backtest_candidate_events').select('*').eq('run_id', id).eq('user_id', user.id).order('signal_timestamp_utc', { ascending: true }),
  ]);
  if (resultError || tradesError || candidatesError || !result) return apiError('BACKTEST_REPORT_FAILED', 'Persisted backtest results could not be loaded.', 500);

  const report = buildBacktestReportModel({ run, result, trades: trades ?? [], user, candidates: persistedCandidates ?? [] });
  const generatedAt = new Date(report.generatedAtUtc);
  const metadata = record(run.metadata);
  const funnel = report.diagnostics.funnel;
  const ruleDiagnostics = [...report.diagnostics.ruleDiagnostics];
  const dataCoverage = [...report.diagnostics.dataCoverage];
  const strategyRules = [...report.strategy.rules];
  const totalTrades = report.performance.totalTrades;
  const outcome = report.performance.outcome;
  const strategyName = report.identity.strategyName;
  const accountName = report.identity.clientName;
  const candidates = [...report.diagnostics.candidates];
  const logo = await readFile(join(process.cwd(), 'public', 'brand', 'trade-police-logo.png'));
  const logoDataUri = `data:image/png;base64,${logo.toString('base64')}`;
  const equityPoints = buildEquityDrawdownSeries(Number(run.starting_balance), run.period_start, trades ?? []);
  const equityHtml = totalTrades ? `<section class="section avoid-break"><div class="section-head"><div><p class="eyebrow">Capital path</p><h2>Equity &amp; drawdown</h2><p>Every point is a persisted post-trade balance. Values use the account currency; dates use UTC.</p></div></div><div class="equity-chart">${renderEquityDrawdownSvg(equityPoints, { width: 960, height: 520 })}</div></section>` : '';

  const funnelRows: Array<[string, string]> = [
    ['Execution candles evaluated', 'execution_candles_evaluated'],
    ['Multi-timeframe context ready', 'multi_timeframe_context_ready'],
    ['Rejected by required historical rules', 'rejected_historical_rules'],
    ['Analysis completed', 'analysis_completed'],
    ['Analysis errors', 'analysis_errors'],
    ['READY candidates found', 'ready_candidate_found'],
    ['Executable signals', 'executable_signals'],
    ['Completed trades', 'completed_trades'],
  ];
  const funnelHtml = funnelRows.map(([label, key]) => `<tr><td>${e(label)}</td><td>${number(funnel[key])}</td></tr>`).join('');
  const ruleHtml = ruleDiagnostics.length
    ? ruleDiagnostics.map(item => `<tr><td><strong>${e(item.label ?? item.rule_id)}</strong><small>${e(item.detector)}</small></td><td>${e(item.timeframe)}</td><td>${item.required ? 'Required' : 'Optional'}</td><td>${number(item.candidate_gate_evaluated)}</td><td>${number(item.candidate_rule_passed)}</td><td>${number(item.candidate_rule_failed)}</td><td>${e(item.rejection_reason)}</td></tr>`).join('')
    : `<tr><td colspan="7"><strong>Detailed rule counters are unavailable for this earlier run.</strong><br>Run the backtest again after this update to record the exact blocking rules.</td></tr>`;
  const coverageHtml = dataCoverage.length
    ? dataCoverage.map(item => `<tr><td>${e(item.timeframe)}</td><td>${number(item.total_bars_loaded)}</td><td>${number(item.warmup_bars_loaded)}</td><td>${number(item.period_bars_loaded)}</td><td>${e(item.first_bar_utc)}</td><td>${e(item.last_bar_utc)}</td><td>${number(item.timestamp_discontinuities)}</td></tr>`).join('')
    : '<tr><td colspan="7">Coverage telemetry was not recorded for this earlier run.</td></tr>';
  const strategyHtml = strategyRules.length
    ? strategyRules.map(rule => `<tr><td>${e(rule.label ?? rule.ruleKey ?? rule.rule_key)}</td><td>${rule.mandatory ? 'Required' : 'Optional'}</td><td>${e(rule.timeframeRole ?? rule.timeframe_role)}</td><td>${e(rule.evaluationMode ?? rule.evaluation_mode)}</td></tr>`).join('')
    : '<tr><td colspan="4">No saved rule snapshot was available.</td></tr>';
  const tradeHtml = totalTrades
    ? (trades ?? []).map(trade => `<tr><td>${e(trade.sequence)}</td><td>${e(trade.direction)}</td><td>${date(trade.entry_timestamp, true)}</td><td>${date(trade.exit_timestamp, true)}</td><td>${number(trade.entry, 4)}</td><td>${number(trade.exit_price, 4)}</td><td>${number(trade.net_r, 2)} R</td><td>${number(trade.net_pnl, 2)}</td><td>${e(trade.exit_reason)}</td></tr>`).join('')
    : '';
  const tradeSectionHtml = totalTrades ? `<section class="section page-break"><div class="section-head"><div><p class="eyebrow">Simulation ledger</p><h2>Trade history</h2><p>${number(totalTrades)} persisted simulated trade${totalTrades === 1 ? '' : 's'}.</p></div></div><div class="table-wrap"><table class="trades"><thead><tr><th>#</th><th>Direction</th><th>Entry time</th><th>Exit time</th><th>Entry</th><th>Exit</th><th>Net R</th><th>Net P&amp;L</th><th>Exit reason</th></tr></thead><tbody>${tradeHtml}</tbody></table></div></section>`
    : `<section class="section page-break"><div class="section-head"><div><p class="eyebrow">No-trade analysis</p><h2>Why no trade was produced</h2><p>No empty trade ledger is included. The evidence below identifies the last completed pipeline stage and the blocking strategy rules.</p></div></div><div class="outcome"><strong>${e(outcome.title)}</strong><p>${e(outcome.explanation)}</p></div><table><tbody>${funnelHtml}</tbody></table></section>`;
  const candidateCounts = candidates.reduce<Record<string, number>>((counts, candidate) => {
    counts[candidate.disposition] = (counts[candidate.disposition] ?? 0) + 1;
    return counts;
  }, {});
  const candidateRows = candidates.map(candidate => `<tr><td>${date(candidate.signalTimestampUtc, true)}</td><td>${e(candidate.direction)}</td><td>${e(candidate.disposition)}</td><td>${e(candidate.terminalStage)}</td><td>${e(candidate.blockingRuleId)}</td><td>${e(candidate.terminalReason)}</td></tr>`).join('');
  const candidateSectionHtml = report.diagnostics.candidateLedgerAvailable
    ? `<section class="section page-break"><div class="section-head"><div><p class="eyebrow">Material opportunities</p><h2>Candidate evidence ledger</h2><p>${number(candidates.length)} material candidates: ${number(candidateCounts.TAKEN ?? 0)} taken, ${number(candidateCounts.REJECTED ?? 0)} rejected, ${number(candidateCounts.ABORTED ?? 0)} aborted. Only TAKEN rows contribute to official performance.</p></div></div>${candidates.length ? `<div class="table-wrap"><table class="rules"><thead><tr><th>Signal UTC</th><th>Direction</th><th>Disposition</th><th>Terminal stage</th><th>Blocking rule</th><th>Reason</th></tr></thead><tbody>${candidateRows}</tbody></table></div>` : '<div class="outcome"><strong>No material candidates were produced.</strong><p>The historical replay completed, but no candidate reached the material-opportunity boundary. Use the funnel and rule diagnostics above to locate the first zero.</p></div>'}</section>`
    : '<section class="section page-break"><div class="outcome"><strong>Candidate ledger unavailable for this legacy run.</strong><p>Run this exact frozen strategy revision again to persist candidate-level evidence.</p></div></section>';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${e(strategyName)} · Trade Police backtest report</title>
<style>
@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:#edf1f5;color:#131b2a;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;font-size:12px;line-height:1.45}.toolbar{position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;gap:10px;padding:12px max(18px,calc((100vw - 920px)/2));background:rgba(237,241,245,.9);backdrop-filter:blur(18px)}.button{appearance:none;border:1px solid #c9d1dc;border-radius:999px;background:#fff;color:#111c2d;padding:10px 17px;font:600 13px inherit;text-decoration:none;cursor:pointer}.button.primary{background:#111c2d;color:#fff;border-color:#111c2d}.sheet{width:min(920px,calc(100% - 28px));margin:0 auto 30px;background:#fff;border:1px solid #dfe4eb;border-radius:24px;box-shadow:0 24px 70px rgba(17,28,45,.12);overflow:hidden}.brand{display:flex;justify-content:space-between;align-items:center;padding:22px 30px;background:#111c2d;color:#fff}.brand-logo{display:block;width:184px;height:auto}.brand small{color:#aab7ca;letter-spacing:.12em;text-transform:uppercase}.content{padding:34px 38px 28px}.eyebrow{margin:0 0 8px;color:#65738a;font-size:10px;font-weight:750;letter-spacing:.16em;text-transform:uppercase}.title{margin:0;font-size:36px;line-height:1.05;letter-spacing:-.04em}.subtitle{margin:9px 0 0;color:#657084;font-size:15px}.identity{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:28px 0}.identity div,.metric{border:1px solid #e1e6ed;border-radius:14px;padding:13px 14px;background:#fafbfc}.identity span,.metric span{display:block;color:#738096;font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase}.identity strong,.metric strong{display:block;margin-top:5px;font-size:13px;overflow-wrap:anywhere}.outcome{margin:22px 0;padding:20px 22px;border-radius:17px;border:1px solid ${outcome.successful ? '#a8ead9' : '#f2cf91'};background:${outcome.successful ? '#edfbf7' : '#fff8e9'}}.outcome h2{margin:0 0 6px;font-size:18px}.outcome p{margin:0;color:#3d4a5d}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.metric strong{font-size:20px;letter-spacing:-.02em}.section{margin-top:30px;padding-top:24px;border-top:1px solid #e3e7ed}.section-head{display:flex;justify-content:space-between;gap:20px;align-items:end;margin-bottom:13px}.section h2{margin:0;font-size:20px}.section p{margin:4px 0 0;color:#68758a}.grid-two{display:grid;grid-template-columns:1fr 1.5fr;gap:18px}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e0e5ec;border-radius:14px;overflow:hidden}th{background:#f2f5f8;color:#5c687c;font-size:9px;letter-spacing:.08em;text-transform:uppercase;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #e6eaf0;vertical-align:top}tr:last-child td{border-bottom:0}td:last-child{text-align:right}td small{display:block;color:#7a8596;margin-top:2px}.rules td:last-child,.trades td:last-child{text-align:left}.audit{display:grid;grid-template-columns:1fr 1fr;gap:10px}.audit div{padding:10px 0;border-bottom:1px solid #e5e9ef}.audit span{display:block;color:#778398;font-size:9px;text-transform:uppercase;letter-spacing:.08em}.audit code{display:block;margin-top:4px;font:9px ui-monospace,SFMono-Regular,Menlo,monospace;overflow-wrap:anywhere;color:#455166}.note{color:#68758a;font-size:10px}.footer{display:flex;justify-content:space-between;gap:20px;margin-top:30px;padding-top:17px;border-top:1px solid #e1e6ed;color:#788396;font-size:10px}
@media(max-width:720px){.content{padding:26px 20px}.title{font-size:29px}.identity,.metrics{grid-template-columns:1fr 1fr}.grid-two{grid-template-columns:1fr}.table-wrap{overflow:auto}.brand{padding:20px}.toolbar{padding:10px 14px}.sheet{width:calc(100% - 16px);border-radius:18px}}
@media print{body{background:#fff;font-size:9px}.toolbar{display:none}.sheet{width:100%;margin:0;border:0;border-radius:0;box-shadow:none}.brand{padding:15px 20px;-webkit-print-color-adjust:exact;print-color-adjust:exact}.content{padding:17px 20px}.title{font-size:28px}.identity{margin:14px 0}.section{margin-top:18px;padding-top:14px}.outcome{margin:14px 0;padding:14px 16px}.metric{padding:9px 10px}.metric strong{font-size:17px}th,td{padding:7px 9px}.outcome,.metric,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.avoid-break{break-inside:avoid}.page-break{break-before:page}.footer{position:running(reportFooter)}}
.equity-chart{overflow:hidden;border:1px solid #e0e5ec;border-radius:14px;background:#fff}.equity-chart svg{display:block;width:100%;height:auto}
</style></head><body>
<div class="toolbar"><span class="note">For a clean PDF, disable browser headers and footers.</span><a class="button" href="/api/backtests/${e(run.id)}/export">Download Excel</a><button class="button primary" id="print-report">Print / Save PDF</button></div>
<main class="sheet"><header class="brand"><img class="brand-logo" src="${logoDataUri}" alt="Trade Police"><small>No trade without evidence.</small></header>
<div class="content"><p class="eyebrow">Historical backtest report</p><h1 class="title">${e(strategyName)}</h1><p class="subtitle">${e(run.instrument)} · ${date(run.period_start)} to ${date(run.period_end)} · UTC</p>
<section class="identity avoid-break"><div><span>Prepared for</span><strong>${e(accountName)}</strong></div><div><span>Account</span><strong>${e(report.identity.clientEmail)}</strong></div><div><span>Report date</span><strong>${date(report.generatedAtUtc, true)}</strong></div><div><span>Report ID</span><strong>${e(report.identity.reportId)}</strong></div></section>
<section class="outcome avoid-break"><p class="eyebrow">${e(outcome.code)}</p><h2>${e(outcome.title)}</h2><p>${e(outcome.explanation)}</p></section>
<section class="metrics avoid-break">${metric('Ending balance', number(result.ending_balance ?? run.starting_balance, 2))}${metric('Total trades', number(totalTrades))}${metric('Net return', totalTrades ? `${number(result.net_return_percent, 2)}%` : 'N/A')}${metric('Win rate', totalTrades ? `${number(result.win_rate, 2)}%` : 'N/A')}${metric('Max drawdown', totalTrades ? `${number(result.max_drawdown_percent, 2)}%` : 'N/A')}${metric('Profit factor', totalTrades ? number(result.profit_factor, 2) : 'N/A')}${metric('Expectancy', totalTrades ? `${number(result.expectancy_r, 2)} R` : 'N/A')}${metric('Average R', totalTrades ? number(result.average_r, 2) : 'N/A')}</section>
<section class="section grid-two"><div><div class="section-head"><div><p class="eyebrow">Configuration</p><h2>Replay parameters</h2></div></div><table><tbody><tr><td>Instrument</td><td>${e(run.instrument)}</td></tr><tr><td>Execution timeframe</td><td>${e(run.execution_timeframe)}</td></tr><tr><td>Canonical timezone</td><td>UTC</td></tr><tr><td>Starting balance</td><td>${number(run.starting_balance, 2)}</td></tr><tr><td>Data provider</td><td>${e(run.data_provider || 'Twelve Data')}</td></tr><tr><td>Engine version</td><td>${e(run.engine_version)}</td></tr><tr><td>Rule logic</td><td>${e(record(metadata.rule_logic).source ?? 'Legacy flat rules')}</td></tr></tbody></table></div><div><div class="section-head"><div><p class="eyebrow">Diagnostics</p><h2>Opportunity funnel</h2></div></div><table><tbody>${funnelHtml}</tbody></table></div></section>
<section class="section page-break"><div class="section-head"><div><p class="eyebrow">Historical data</p><h2>Coverage by timeframe</h2><p>All timestamps and period boundaries use UTC. Discontinuities include scheduled market closures and should not automatically be interpreted as provider failures.</p></div></div><div class="table-wrap"><table><thead><tr><th>Timeframe</th><th>Total</th><th>Warm-up</th><th>Test period</th><th>First bar UTC</th><th>Last bar UTC</th><th>Discontinuities</th></tr></thead><tbody>${coverageHtml}</tbody></table></div></section>
<section class="section"><div class="section-head"><div><p class="eyebrow">Rule diagnostics</p><h2>Why opportunities passed or stopped</h2><p>Gate evaluated, passed, and failed are sequential candidate counts in saved rule-tree order. Raw detector observations across every replay candle are separate telemetry and never replace the candidate funnel.</p></div></div><div class="table-wrap"><table class="rules"><thead><tr><th>Rule</th><th>Timeframe</th><th>Role</th><th>Gate evaluated</th><th>Rule passed</th><th>Rule failed</th><th>Reason</th></tr></thead><tbody>${ruleHtml}</tbody></table></div></section>
<section class="section"><div class="section-head"><div><p class="eyebrow">Frozen strategy revision</p><h2>Saved rules used by this replay</h2></div></div><div class="table-wrap"><table class="rules"><thead><tr><th>Rule</th><th>Requirement</th><th>Timeframe role</th><th>Evaluation</th></tr></thead><tbody>${strategyHtml}</tbody></table></div></section>
${equityHtml}
${candidateSectionHtml}
${tradeSectionHtml}
<section class="section"><div class="section-head"><div><p class="eyebrow">Methodology</p><h2>Scope and limitations</h2></div></div><p>Historical OHLC replay uses the exact saved strategy revision and deterministic Trade Police detectors. Entry occurs at the next execution-candle open after an eligible signal. If stop and target are both touched within one candle, the conservative stop-first policy applies.</p><p>Historical spread, commission, slippage, news, and external or manual confirmations are not inferred unless explicitly present in the dataset. Historical performance does not guarantee future results.</p></section>
<section class="section audit"><div><span>Strategy revision</span><code>${e(run.strategy_revision_id)}</code></div><div><span>Snapshot hash</span><code>${e(run.strategy_snapshot_hash)}</code></div><div><span>Data fingerprint</span><code>${e(report.methodology.dataFingerprint)}</code></div><div><span>Website</span><code>tradepolice.app</code></div></section>
<footer class="footer"><span>Prepared for ${e(accountName)} · Confidential</span><span>© ${generatedAt.getUTCFullYear()} Trade Police</span></footer></div></main>
<script nonce="trade-police-report">document.getElementById('print-report')?.addEventListener('click',()=>window.print());</script></body></html>`;

  return new Response(html, { headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `inline; filename="${safeFilePart(strategyName)}-backtest-report.html"`,
    'Cache-Control': 'private, no-store',
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-trade-police-report'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } });
}
