import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { NextResponse } from 'next/server';
import sharp from 'sharp';

import { buildEquityDrawdownSeries, renderEquityDrawdownSvg } from '@/lib/backtesting/backtest-report-chart';
import { buildBacktestReportModel } from '@/lib/backtesting/backtest-report-model';
import { apiError } from '@/lib/server/public-error';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const NAVY = 'FF111C2D';
const INK = 'FF172033';
const MUTED = 'FF667085';
const PALE = 'FFF2F5F8';
const LINE = 'FFD8DEE8';
const WHITE = 'FFFFFFFF';

function safeFilePart(value: string) {
  return value.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'backtest';
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function dateValue(value: unknown): Date | string {
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? String(value ?? '—') : date;
}

function excelText(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value ?? '');
  return text.length <= 32_000 ? text : `${text.slice(0, 31_900)}\n[TRUNCATED IN CELL — verify with the recorded snapshot hash]`;
}

function section(sheet: ExcelJS.Worksheet, row: number, title: string, endColumn = 8) {
  sheet.mergeCells(row, 1, row, endColumn);
  const cell = sheet.getCell(row, 1);
  cell.value = title.toUpperCase();
  cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: MUTED } };
  cell.alignment = { vertical: 'middle' };
  sheet.getRow(row).height = 24;
}

function field(sheet: ExcelJS.Worksheet, row: number, labelColumn: number, label: string, value: unknown, span = 2) {
  const valueColumn = labelColumn + 1;
  const endColumn = valueColumn + span - 1;
  if (span > 1) sheet.mergeCells(row, valueColumn, row, endColumn);
  const labelCell = sheet.getCell(row, labelColumn);
  const valueCell = sheet.getCell(row, valueColumn);
  labelCell.value = label;
  labelCell.font = { name: 'Aptos', size: 9, bold: true, color: { argb: MUTED } };
  valueCell.value = value as ExcelJS.CellValue;
  valueCell.font = { name: 'Aptos', size: 10, color: { argb: INK } };
  valueCell.alignment = { vertical: 'middle', wrapText: true };
}

function configurePage(sheet: ExcelJS.Worksheet, orientation: 'portrait' | 'landscape' = 'portrait') {
  sheet.pageSetup = {
    paperSize: 9,
    orientation,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.35, right: 0.35, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter.oddFooter = '&LTrade Police · tradepolice.app&CConfidential&RPage &P of &N';
  sheet.properties.defaultRowHeight = 20;
  sheet.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
}

function tableHeader(row: ExcelJS.Row) {
  row.font = { name: 'Aptos', size: 9, bold: true, color: { argb: WHITE } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.height = 26;
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return apiError('UNAUTHORIZED', 'Unauthorized.', 401);

  const { id } = await params;
  const { data: run, error: runError } = await supabase.from('backtest_runs').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (runError) return apiError('BACKTEST_EXPORT_FAILED', 'Backtest report could not be loaded.', 500);
  if (!run) return apiError('BACKTEST_NOT_FOUND', 'Backtest run not found.', 404);
  if (run.status !== 'COMPLETED') return apiError('BACKTEST_NOT_COMPLETED', 'Only completed backtests can be exported.', 409);

  const [{ data: result, error: resultError }, { data: trades, error: tradesError }, { data: candidates, error: candidatesError }] = await Promise.all([
    supabase.from('backtest_results').select('*').eq('run_id', id).maybeSingle(),
    supabase.from('backtest_trades').select('*').eq('run_id', id).order('sequence', { ascending: true }),
    supabase.from('backtest_candidate_events').select('*').eq('run_id', id).eq('user_id', user.id).order('signal_timestamp_utc', { ascending: true }),
  ]);
  if (resultError || tradesError || candidatesError || !result) return apiError('BACKTEST_EXPORT_FAILED', 'Persisted backtest results could not be loaded.', 500);

  const report = buildBacktestReportModel({ run, result, trades: trades ?? [], user, candidates: candidates ?? [] });
  const generatedAt = new Date(report.generatedAtUtc);
  const metadata = record(run.metadata);
  const funnel = report.diagnostics.funnel;
  const ruleDiagnostics = [...report.diagnostics.ruleDiagnostics];
  const dataCoverage = [...report.diagnostics.dataCoverage];
  const strategyRules = [...report.strategy.rules];
  const candidateEvents = [...report.diagnostics.candidates];
  const totalTrades = report.performance.totalTrades;
  const outcome = report.performance.outcome;
  const strategyName = report.identity.strategyName;
  const accountName = report.identity.clientName;
  const equityPoints = buildEquityDrawdownSeries(Number(run.starting_balance), run.period_start, trades ?? []);
  const logoBuffer = await readFile(join(process.cwd(), 'public', 'brand', 'trade-police-logo.png'));

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Trade Police';
  workbook.company = 'Trade Police';
  workbook.subject = `Backtest report for ${strategyName}`;
  workbook.title = `${strategyName} backtest report`;
  workbook.description = outcome.explanation;
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  workbook.calcProperties.fullCalcOnLoad = true;

  const overview = workbook.addWorksheet('Summary');
  configurePage(overview);
  overview.columns = [
    { width: 18 }, { width: 20 }, { width: 15 }, { width: 18 },
    { width: 18 }, { width: 20 }, { width: 15 }, { width: 18 },
  ];
  overview.mergeCells('A1:H1');
  overview.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  overview.getRow(1).height = 42;
  const logoImageId = workbook.addImage({ base64: `data:image/png;base64,${logoBuffer.toString('base64')}`, extension: 'png' });
  overview.addImage(logoImageId, { tl: { col: 0.15, row: 0.12 }, ext: { width: 174, height: 45 } });
  overview.mergeCells('A2:H2');
  overview.getCell('A2').value = 'Historical backtest report';
  overview.getCell('A2').font = { name: 'Aptos Display', size: 24, bold: true, color: { argb: INK } };
  overview.getRow(2).height = 42;
  overview.mergeCells('A3:H3');
  overview.getCell('A3').value = `${strategyName} · ${run.instrument}`;
  overview.getCell('A3').font = { name: 'Aptos', size: 12, color: { argb: MUTED } };

  section(overview, 5, 'Report identity');
  field(overview, 6, 1, 'Client', accountName, 3);
  field(overview, 6, 5, 'Account email', user.email ?? '—', 3);
  field(overview, 7, 1, 'Report ID', report.identity.reportId, 3);
  field(overview, 7, 5, 'Generated', generatedAt, 3);
  field(overview, 8, 1, 'Website', 'tradepolice.app', 3);
  field(overview, 8, 5, 'Completed', dateValue(run.completed_at), 3);
  overview.getCell('F7').numFmt = 'mmm d, yyyy h:mm AM/PM';
  overview.getCell('F8').numFmt = 'mmm d, yyyy h:mm AM/PM';

  section(overview, 10, 'Backtest configuration');
  field(overview, 11, 1, 'Strategy', strategyName, 3);
  field(overview, 11, 5, 'Instrument', run.instrument, 3);
  field(overview, 12, 1, 'Period start', dateValue(run.period_start), 3);
  field(overview, 12, 5, 'Period end', dateValue(run.period_end), 3);
  field(overview, 13, 1, 'Execution timeframe', run.execution_timeframe, 3);
  field(overview, 13, 5, 'Starting balance', Number(run.starting_balance), 3);
  field(overview, 14, 1, 'Data provider', run.data_provider || 'Twelve Data', 3);
  field(overview, 14, 5, 'Engine version', run.engine_version, 3);
  field(overview, 15, 1, 'Canonical timezone', 'UTC', 3);
  field(overview, 15, 5, 'Rule logic source', record(metadata.rule_logic).source ?? 'Legacy flat rules', 3);
  overview.getCell('B12').numFmt = 'mmm d, yyyy';
  overview.getCell('F12').numFmt = 'mmm d, yyyy';
  overview.getCell('F13').numFmt = '#,##0.00';

  section(overview, 16, 'Outcome');
  overview.mergeCells('A17:H17');
  overview.getCell('A17').value = outcome.title;
  overview.getCell('A17').font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: outcome.successful ? 'FF087F5B' : 'FFB54708' } };
  overview.mergeCells('A18:H19');
  overview.getCell('A18').value = outcome.explanation;
  overview.getCell('A18').alignment = { vertical: 'top', wrapText: true };
  overview.getCell('A18').font = { name: 'Aptos', size: 10, color: { argb: INK } };
  overview.getCell('A18').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: outcome.successful ? 'FFEAFBF6' : 'FFFFF4E5' } };

  section(overview, 21, 'Performance summary');
  const metrics: Array<[string, unknown, string, unknown]> = [
    ['Ending balance', Number(result.ending_balance ?? run.starting_balance), 'Total trades', totalTrades],
    ['Net return', totalTrades ? Number(result.net_return_percent ?? 0) / 100 : 'N/A', 'Win rate', totalTrades ? Number(result.win_rate ?? 0) / 100 : 'N/A'],
    ['Max drawdown', totalTrades ? Number(result.max_drawdown_percent ?? 0) / 100 : 'N/A', 'Expectancy', totalTrades ? Number(result.expectancy_r ?? 0) : 'N/A'],
    ['Profit factor', totalTrades ? result.profit_factor ?? 'N/A' : 'N/A', 'Average R', totalTrades ? Number(result.average_r ?? 0) : 'N/A'],
  ];
  metrics.forEach(([leftLabel, leftValue, rightLabel, rightValue], index) => {
    const row = 22 + index;
    field(overview, row, 1, leftLabel, leftValue, 3);
    field(overview, row, 5, rightLabel, rightValue, 3);
  });
  overview.getCell('B22').numFmt = '#,##0.00';
  for (const cell of ['B23', 'F23', 'B24']) overview.getCell(cell).numFmt = '0.00%';
  for (const cell of ['F24', 'F25']) overview.getCell(cell).numFmt = '0.00';

  section(overview, 28, 'Audit trail');
  field(overview, 29, 1, 'Strategy revision', run.strategy_revision_id, 7);
  field(overview, 30, 1, 'Snapshot hash', run.strategy_snapshot_hash, 7);
  field(overview, 31, 1, 'Data fingerprint', report.methodology.dataFingerprint || '—', 7);
  for (const row of [29, 30, 31]) overview.getCell(row, 2).font = { name: 'Aptos Mono', size: 8, color: { argb: MUTED } };
  overview.pageSetup.printArea = 'A1:H32';

  const diagnostics = workbook.addWorksheet('Rule Diagnostics');
  configurePage(diagnostics, 'landscape');
  diagnostics.columns = [
    { width: 28 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 28 },
  ];
  diagnostics.mergeCells('A1:I1');
  diagnostics.getCell('A1').value = 'OPPORTUNITY FUNNEL';
  diagnostics.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: WHITE } };
  diagnostics.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  diagnostics.getRow(1).height = 34;
  diagnostics.addRow([]);
  diagnostics.addRow(['Stage', 'Count']);
  tableHeader(diagnostics.getRow(3));
  const funnelFields: Array<[string, string]> = [
    ['Execution candles evaluated', 'execution_candles_evaluated'], ['Multi-timeframe context ready', 'multi_timeframe_context_ready'],
    ['Rejected by required historical rules', 'rejected_historical_rules'], ['Analysis completed', 'analysis_completed'],
    ['Analysis errors', 'analysis_errors'], ['READY candidate found', 'ready_candidate_found'],
    ['Rejected: no READY candidate', 'rejected_no_ready_candidate'], ['Setup readiness READY', 'setup_readiness_ready'],
    ['Direction allowed', 'direction_allowed'], ['Daily limit allowed', 'daily_limit_allowed'],
    ['Valid risk geometry', 'valid_risk_geometry'], ['Executable signals', 'executable_signals'], ['Completed trades', 'completed_trades'],
  ];
  funnelFields.forEach(([label, key]) => diagnostics.addRow([label, Number(funnel[key] ?? 0)]));
  const ruleStart = diagnostics.lastRow!.number + 3;
  diagnostics.mergeCells(ruleStart, 1, ruleStart, 9);
  diagnostics.getCell(ruleStart, 1).value = 'RULE AUDIT';
  diagnostics.getCell(ruleStart, 1).font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: INK } };
  diagnostics.addRow(['Rule', 'Detector', 'Timeframe', 'Required', 'Gate evaluated', 'Rule passed', 'Rule failed', 'Observed insufficient', 'Reason']);
  tableHeader(diagnostics.getRow(ruleStart + 1));
  if (ruleDiagnostics.length) {
    ruleDiagnostics.forEach(item => diagnostics.addRow([
      item.label ?? item.rule_id, item.detector, item.timeframe, item.required ? 'Yes' : 'No', Number(item.candidate_gate_evaluated ?? 0),
      Number(item.candidate_rule_passed ?? 0), Number(item.candidate_rule_failed ?? 0), Number(item.observed_insufficient_data ?? 0), item.rejection_reason ?? '—',
    ]));
  } else {
    diagnostics.addRow(['Detailed rule counters were not recorded for this legacy run.', '', '', '', '', '', '', '', 'Run the backtest again after this update.']);
  }
  diagnostics.getColumn(9).alignment = { wrapText: true };
  const coverageStart = diagnostics.lastRow!.number + 3;
  diagnostics.mergeCells(coverageStart, 1, coverageStart, 9);
  diagnostics.getCell(coverageStart, 1).value = 'HISTORICAL DATA COVERAGE · UTC';
  diagnostics.getCell(coverageStart, 1).font = { name: 'Aptos Display', size: 15, bold: true, color: { argb: INK } };
  diagnostics.addRow(['Timeframe', 'Interval min', 'Total loaded', 'Warm-up loaded', 'Period loaded', 'First bar UTC', 'Last bar UTC', 'Discontinuities', 'Largest gap min']);
  tableHeader(diagnostics.getRow(coverageStart + 1));
  if (dataCoverage.length) dataCoverage.forEach(item => diagnostics.addRow([
    item.timeframe, Number(item.interval_minutes ?? 0), Number(item.total_bars_loaded ?? 0), Number(item.warmup_bars_loaded ?? 0),
    Number(item.period_bars_loaded ?? 0), item.first_bar_utc, item.last_bar_utc, Number(item.timestamp_discontinuities ?? 0), Number(item.largest_gap_minutes ?? 0),
  ]));
  else diagnostics.addRow(['Coverage telemetry was not recorded for this earlier run.', '', '', '', '', '', '', '', '']);
  diagnostics.pageSetup.printArea = `A1:I${diagnostics.lastRow!.number}`;

  const strategySheet = workbook.addWorksheet('Executable Rules');
  configurePage(strategySheet, 'landscape');
  strategySheet.columns = [{ width: 30 }, { width: 14 }, { width: 12 }, { width: 18 }, { width: 20 }, { width: 62 }];
  strategySheet.mergeCells('A1:F1');
  strategySheet.getCell('A1').value = 'SAVED STRATEGY RULES';
  strategySheet.getCell('A1').font = { name: 'Aptos Display', size: 18, bold: true, color: { argb: WHITE } };
  strategySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  strategySheet.addRow([]);
  strategySheet.addRow(['Rule', 'Required', 'Enabled', 'Timeframe role', 'Evaluation mode', 'Rule key']);
  tableHeader(strategySheet.getRow(3));
  strategyRules.forEach(rule => strategySheet.addRow([
    rule.label ?? rule.ruleKey ?? rule.rule_key, rule.mandatory ? 'Yes' : 'No', rule.enabled === false ? 'No' : 'Yes',
    rule.timeframeRole ?? rule.timeframe_role, rule.evaluationMode ?? rule.evaluation_mode, rule.ruleKey ?? rule.rule_key,
  ]));
  if (!strategyRules.length) strategySheet.addRow(['No saved rule snapshot was available.', '', '', '', '', '']);
  strategySheet.getColumn(6).font = { name: 'Aptos Mono', size: 8, color: { argb: MUTED } };
  strategySheet.getColumn(6).alignment = { wrapText: true, vertical: 'top' };
  strategySheet.pageSetup.printArea = `A1:F${strategySheet.lastRow!.number}`;

  const tradeSheet = workbook.addWorksheet('Taken Trades');
  configurePage(tradeSheet, 'landscape');
  tradeSheet.columns = [
    { header: '#', key: 'sequence', width: 7 }, { header: 'Direction', key: 'direction', width: 12 },
    { header: 'Entry time', key: 'entry_timestamp', width: 22 }, { header: 'Exit time', key: 'exit_timestamp', width: 22 },
    { header: 'Entry', key: 'entry', width: 14 }, { header: 'Stop', key: 'stop_loss', width: 14 },
    { header: 'Target', key: 'take_profit', width: 14 }, { header: 'Exit', key: 'exit_price', width: 14 },
    { header: 'Net P&L', key: 'net_pnl', width: 14 }, { header: 'Net R', key: 'net_r', width: 10 },
    { header: 'Balance before', key: 'balance_before', width: 17 }, { header: 'Balance after', key: 'balance_after', width: 17 },
    { header: 'Setup', key: 'setup_type', width: 22 }, { header: 'Exit reason', key: 'exit_reason', width: 28 },
  ];
  tableHeader(tradeSheet.getRow(1));
  tradeSheet.addRows((trades ?? []).map(trade => ({
    ...trade,
    entry_timestamp: dateValue(trade.entry_timestamp), exit_timestamp: dateValue(trade.exit_timestamp),
    entry: Number(trade.entry), stop_loss: trade.stop_loss == null ? '' : Number(trade.stop_loss), take_profit: trade.take_profit == null ? '' : Number(trade.take_profit),
    exit_price: trade.exit_price == null ? '' : Number(trade.exit_price), net_pnl: trade.net_pnl == null ? '' : Number(trade.net_pnl), net_r: trade.net_r == null ? '' : Number(trade.net_r),
  })));
  if (!totalTrades) {
    tradeSheet.addRow({ direction: 'No trades' });
    tradeSheet.mergeCells('B2:N3');
    tradeSheet.getCell('B2').value = outcome.explanation;
    tradeSheet.getCell('B2').alignment = { wrapText: true, vertical: 'middle' };
    tradeSheet.getCell('B2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
  }
  for (const column of [3, 4]) tradeSheet.getColumn(column).numFmt = 'mmm d, yyyy h:mm AM/PM';
  for (const column of [5, 6, 7, 8, 9, 10, 11, 12]) tradeSheet.getColumn(column).numFmt = '#,##0.0000';
  tradeSheet.autoFilter = { from: 'A1', to: 'N1' };
  tradeSheet.pageSetup.printArea = `A1:N${Math.max(3, tradeSheet.lastRow!.number)}`;

  const method = workbook.addWorksheet('Methodology');
  configurePage(method);
  method.columns = [{ width: 26 }, { width: 92 }];
  method.addRow(['Methodology', 'Historical OHLC replay using the exact saved strategy revision and deterministic Trade Police rule detectors.']);
  method.addRow(['Data source', `${run.data_provider || 'Twelve Data'} historical candles. Evaluated timeframes: ${Array.isArray(metadata.evaluated_frames) ? metadata.evaluated_frames.join(', ') : run.execution_timeframe}.`]);
  method.addRow(['Canonical timezone', 'UTC. Period boundaries, candle timestamps, diagnostics, PDF, and workbook dates use the same UTC basis.']);
  method.addRow(['Rule logic', `The frozen strategy rule tree was evaluated using ${String(record(metadata.rule_logic).source ?? 'legacy flat-rule semantics')}. ALL groups require every child; ANY groups require at least one child.`]);
  method.addRow(['Execution model', 'Entry uses the next execution candle open after an eligible signal. Intrabar stop/target ambiguity uses the conservative stop-first policy.']);
  method.addRow(['Costs', 'Historical spread, commission, slippage, news, and external/manual confirmations are not inferred unless explicitly available in the dataset.']);
  method.addRow(['Interpretation', 'A backtest is a historical simulation, not a guarantee of future performance. A zero-trade run is only conclusive when the diagnostic funnel identifies the stage that rejected all opportunities.']);
  method.addRow(['Confidentiality', `Prepared for ${accountName}. Strategy rules and report identifiers may contain private trading information.`]);
  method.getColumn(1).font = { name: 'Aptos', size: 10, bold: true, color: { argb: MUTED } };
  method.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
  method.getColumn(2).font = { name: 'Aptos', size: 10, color: { argb: INK } };
  method.eachRow(row => { row.height = 42; row.border = { bottom: { style: 'thin', color: { argb: LINE } } }; });
  method.pageSetup.printArea = `A1:B${method.lastRow!.number}`;

  const strategyDefinition = workbook.addWorksheet('Strategy Definition');
  configurePage(strategyDefinition, 'landscape');
  strategyDefinition.columns = [{ width: 30 }, { width: 110 }];
  strategyDefinition.addRow(['Field', 'Frozen value']);
  tableHeader(strategyDefinition.getRow(1));
  Object.entries(report.strategy.snapshot).forEach(([key, value]) => strategyDefinition.addRow([
    key,
    excelText(value),
  ]));
  strategyDefinition.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  const coverageSheet = workbook.addWorksheet('Data Coverage');
  configurePage(coverageSheet, 'landscape');
  coverageSheet.columns = [
    { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 24 }, { width: 24 }, { width: 18 }, { width: 18 },
  ];
  coverageSheet.addRow(['Timeframe', 'Interval min', 'Total loaded', 'Warm-up loaded', 'Period loaded', 'First bar UTC', 'Last bar UTC', 'Discontinuities', 'Largest gap min']);
  tableHeader(coverageSheet.getRow(1));
  dataCoverage.forEach(item => coverageSheet.addRow([
    item.timeframe, Number(item.interval_minutes ?? 0), Number(item.total_bars_loaded ?? 0), Number(item.warmup_bars_loaded ?? 0),
    Number(item.period_bars_loaded ?? 0), item.first_bar_utc, item.last_bar_utc,
    Number(item.timestamp_discontinuities ?? 0), Number(item.largest_gap_minutes ?? 0),
  ]));
  if (!dataCoverage.length) coverageSheet.addRow(['Coverage telemetry unavailable for this legacy run.']);

  const addCandidateSheet = (name: string, disposition?: string) => {
    const sheet = workbook.addWorksheet(name);
    configurePage(sheet, 'landscape');
    sheet.columns = [
      { width: 24 }, { width: 12 }, { width: 16 }, { width: 24 }, { width: 28 },
      { width: 58 }, { width: 16 }, { width: 64 },
    ];
    sheet.addRow(['Signal UTC', 'Direction', 'Disposition', 'Terminal stage', 'Blocking rule', 'Terminal reason', 'Trade #', 'Rule evaluations']);
    tableHeader(sheet.getRow(1));
    const rows = disposition ? candidateEvents.filter(candidate => candidate.disposition === disposition) : candidateEvents;
    rows.forEach(candidate => sheet.addRow([
      dateValue(candidate.signalTimestampUtc), candidate.direction ?? '—', candidate.disposition, candidate.terminalStage,
      candidate.blockingRuleId ?? '—', candidate.terminalReason, candidate.officialTradeSequence ?? '—',
      excelText(candidate.ruleEvaluations),
    ]));
    if (!rows.length) sheet.addRow([report.diagnostics.candidateLedgerAvailable
      ? `No ${disposition ? disposition.toLowerCase() : 'candidate'} events were recorded.`
      : 'Candidate evidence is unavailable for this legacy run; rerun the frozen revision to populate it.']);
    sheet.getColumn(1).numFmt = 'mmm d, yyyy h:mm:ss AM/PM';
    sheet.getColumn(8).alignment = { wrapText: true, vertical: 'top' };
    sheet.autoFilter = { from: 'A1', to: 'H1' };
    return sheet;
  };
  addCandidateSheet('Candidates');
  addCandidateSheet('Rejected Trades', 'REJECTED');
  addCandidateSheet('Aborted Trades', 'ABORTED');

  const overrideSheet = workbook.addWorksheet('Override Scenarios');
  configurePage(overrideSheet, 'landscape');
  overrideSheet.columns = [{ width: 24 }, { width: 20 }, { width: 28 }, { width: 80 }];
  overrideSheet.addRow(['Signal UTC', 'Direction', 'Blocking rule', 'Hypothetical evidence']);
  tableHeader(overrideSheet.getRow(1));
  const overrides = candidateEvents.filter(candidate => candidate.disposition === 'OVERRIDE_ELIGIBLE');
  overrides.forEach(candidate => overrideSheet.addRow([dateValue(candidate.signalTimestampUtc), candidate.direction ?? '—', candidate.blockingRuleId ?? '—', excelText(candidate.hypothetical)]));
  if (!overrides.length) overrideSheet.addRow(['No canonical override scenarios were recorded. Official performance excludes hypothetical outcomes.']);

  const performanceSheet = workbook.addWorksheet('Performance');
  configurePage(performanceSheet);
  performanceSheet.columns = [{ width: 30 }, { width: 28 }];
  performanceSheet.addRow(['Metric', 'Persisted value']);
  tableHeader(performanceSheet.getRow(1));
  Object.entries(report.performance.result).forEach(([key, value]) => performanceSheet.addRow([key, value != null && typeof value === 'object' ? excelText(value) : value as ExcelJS.CellValue]));

  const equitySheet = workbook.addWorksheet('Equity Time Series');
  configurePage(equitySheet, 'landscape');
  equitySheet.columns = [
    { width: 10 }, { width: 24 }, { width: 18 }, { width: 18 }, { width: 16 },
    { width: 14 }, { width: 18 }, { width: 16 }, { width: 16 },
  ];
  if (totalTrades) {
    const chartSvg = renderEquityDrawdownSvg(equityPoints, { width: 1100, height: 560 });
    const chartPng = await sharp(Buffer.from(chartSvg)).png().toBuffer();
    const chartImageId = workbook.addImage({ base64: `data:image/png;base64,${chartPng.toString('base64')}`, extension: 'png' });
    equitySheet.addImage(chartImageId, { tl: { col: 0, row: 0 }, ext: { width: 990, height: 504 } });
    for (let row = 1; row <= 28; row += 1) equitySheet.getRow(row).height = 18;
    const tableRow = 30;
    equitySheet.getRow(tableRow).values = ['Trade #', 'Exit UTC', 'Balance before', 'Balance after', 'Net P&L', 'Net R', 'Peak balance', 'Drawdown %', 'Cumulative R'];
    tableHeader(equitySheet.getRow(tableRow));
    (trades ?? []).forEach((trade, index) => {
      const point = equityPoints[index + 1];
      equitySheet.addRow([
        trade.sequence, dateValue(trade.exit_timestamp), Number(trade.balance_before), Number(trade.balance_after), Number(trade.net_pnl), Number(trade.net_r),
        point.peakBalance, point.drawdownPercent / 100, point.cumulativeR,
      ]);
    });
    equitySheet.getColumn(2).numFmt = 'mmm d, yyyy h:mm AM/PM';
    for (const column of [3, 4, 5, 7, 9]) equitySheet.getColumn(column).numFmt = '#,##0.00';
    equitySheet.getColumn(6).numFmt = '0.00" R"';
    equitySheet.getColumn(8).numFmt = '0.00%';
    equitySheet.autoFilter = { from: `A${tableRow}`, to: `I${tableRow}` };
    equitySheet.pageSetup.printArea = `A1:I${equitySheet.lastRow!.number}`;
  } else {
    equitySheet.mergeCells('A1:I2');
    equitySheet.getCell('A1').value = 'NO EQUITY CURVE — THE COMPLETED REPLAY PRODUCED ZERO SIMULATED TRADES';
    equitySheet.getCell('A1').font = { name: 'Aptos Display', size: 16, bold: true, color: { argb: WHITE } };
    equitySheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    equitySheet.getCell('A1').alignment = { vertical: 'middle', wrapText: true };
    equitySheet.mergeCells('A4:I7');
    equitySheet.getCell('A4').value = `${outcome.explanation}\n\nUse Rule Diagnostics, Data Coverage, and Candidates to identify the first stage that reached zero.`;
    equitySheet.getCell('A4').alignment = { vertical: 'top', wrapText: true };
    equitySheet.getCell('A4').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PALE } };
    equitySheet.pageSetup.printArea = 'A1:I7';
  }

  const metadataSheet = workbook.addWorksheet('Run Metadata');
  configurePage(metadataSheet, 'landscape');
  metadataSheet.columns = [{ width: 34 }, { width: 110 }];
  metadataSheet.addRow(['Field', 'Value']);
  tableHeader(metadataSheet.getRow(1));
  const runMetadata: Record<string, unknown> = {
    report_id: report.identity.reportId,
    backtest_id: report.identity.backtestId,
    generated_at_utc: report.generatedAtUtc,
    completed_at_utc: report.audit.completedAtUtc,
    strategy_id: report.identity.strategyId,
    strategy_revision_id: report.identity.strategyRevisionId,
    strategy_snapshot_hash: report.identity.strategySnapshotHash,
    historical_data_fingerprint: report.methodology.dataFingerprint,
    engine_version: report.methodology.engineVersion,
    canonical_timezone: report.methodology.timezone,
    report_model_version: report.version,
    candidate_ledger_available: report.diagnostics.candidateLedgerAvailable,
    hypothetical_separated_from_official_performance: report.audit.hypotheticalSeparatedFromOfficialPerformance,
  };
  Object.entries(runMetadata).forEach(([key, value]) => metadataSheet.addRow([key, String(value ?? '—')]));
  metadataSheet.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

  for (const sheet of workbook.worksheets) {
    sheet.eachRow(row => row.eachCell(cell => {
      if (!cell.font?.name) cell.font = { ...cell.font, name: 'Aptos', color: { argb: INK } };
      cell.alignment = { vertical: 'middle', ...cell.alignment };
    }));
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `${safeFilePart(strategyName)}-${safeFilePart(String(run.period_start).slice(0, 10))}-backtest-report.xlsx`;
  return new NextResponse(Buffer.from(buffer), { headers: {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
  } });
}
