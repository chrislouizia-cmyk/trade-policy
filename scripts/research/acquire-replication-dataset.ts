import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { HistoricalDatasetManager, InMemoryHistoricalDatasetRepository } from '../../lib/market-intelligence-lab/historical-datasets/index.ts';
import { ReplicationDatasetAcquisitionService, TwelveDataHistoricalAcquirer, type AcquisitionTimeframe } from '../../lib/market-intelligence-lab/historical-acquisition/index.ts';

const timeframe = process.env.RESEARCH_TIMEFRAME as AcquisitionTimeframe, startAt = process.env.RESEARCH_START_AT, endAt = process.env.RESEARCH_END_AT, version = process.env.RESEARCH_DATASET_VERSION ?? '1.0.0', acquiredAt = new Date().toISOString();
if (!['M5', 'M15', 'H1'].includes(timeframe) || !startAt || !endAt) throw new Error('RESEARCH_TIMEFRAME, RESEARCH_START_AT, and RESEARCH_END_AT are required.');
const artifactId = `TP-REP-XAUUSD-2026-01-${timeframe}-${startAt.slice(0, 10)}-${endAt.slice(0, 10)}-v${version}`, root = new URL(`../../research-artifacts/datasets/${artifactId}/`, import.meta.url);
try { await access(root, constants.F_OK); throw new Error(`${artifactId} already exists and is immutable.`); } catch (error) { if (error instanceof Error && error.message.includes('already exists')) throw error; }
const repository = new InMemoryHistoricalDatasetRepository(() => acquiredAt), manager = new HistoricalDatasetManager(repository), acquirer = new TwelveDataHistoricalAcquirer(process.env.TWELVE_DATA_API_KEY ?? ''), service = new ReplicationDatasetAcquisitionService(acquirer, manager);
const certification = await service.acquireAndCertify({ instrument: 'XAUUSD', timeframe, startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString(), acquiredAt, provider: 'Twelve Data', timezone: 'UTC' }, version, 'trade-police-research');
const dataset = await manager.getDataset(certification.dataset.id); if (!dataset) throw new Error('Certified dataset could not be reloaded.');
await mkdir(root, { recursive: true });
await Promise.all([writeFile(new URL('certification.json', root), `${JSON.stringify(certification, null, 2)}\n`, { flag: 'wx' }), writeFile(new URL('manifest.json', root), `${JSON.stringify(dataset.manifest, null, 2)}\n`, { flag: 'wx' }), writeFile(new URL('candles.json', root), `${JSON.stringify(dataset.candles)}\n`, { flag: 'wx' })]);
console.log(JSON.stringify({ artifactId, programId: certification.programId, datasetId: dataset.manifest.id, datasetHash: dataset.manifest.contentHash, status: dataset.manifest.status, timeframe, candleCount: dataset.manifest.candleCount, startAt: dataset.manifest.startAt, endAt: dataset.manifest.endAt, certificationHash: certification.certificationHash, output: root.pathname }));
