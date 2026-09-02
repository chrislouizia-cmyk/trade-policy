import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLocale, normalizeLocale, SUPPORTED_LOCALES } from '../lib/i18n/config.ts';
import { messages, translate } from '../lib/i18n/messages.ts';
import {getScreenCopy} from '../lib/i18n/screen-copy.ts';
import {getAuthCopy} from '../lib/i18n/auth-copy.ts';
import {workspaceText} from '../lib/i18n/workspace-copy.ts';

test('normalizes supported regional language tags', () => {
  assert.equal(normalizeLocale('es-MX'), 'es');
  assert.equal(normalizeLocale('fr-CA'), 'fr');
  assert.equal(normalizeLocale('en_US'), 'en');
  assert.equal(normalizeLocale('de-DE'), null);
});

test('customer workflows expose Spanish and French screen copy', () => {
  assert.equal(getScreenCopy('es').active.close, 'Cerrar trade');
  assert.equal(getScreenCopy('fr').history.timeline, 'Chronologie du journal');
  assert.equal(getScreenCopy('es').analytics.failed, 'No se pudo cargar Analytics');
  assert.equal(getAuthCopy('fr').recover, 'Récupérer le mot de passe');
  assert.equal(workspaceText('es', 'Run Backtest'), 'Ejecutar backtest');
  assert.equal(workspaceText('fr', 'Take trade'), 'Prendre le trade');
});

test('uses Accept-Language quality ordering with English fallback', () => {
  assert.equal(detectLocale('en-US;q=0.7, fr-CA;q=0.9, es;q=0.8'), 'fr');
  assert.equal(detectLocale('de-DE, pt-BR;q=0.8'), 'en');
  assert.equal(detectLocale(null), 'en');
});

test('all supported locales have a complete catalog', () => {
  const englishKeys = Object.keys(messages.en).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(Object.keys(messages[locale]).sort(), englishKeys);
  }
  assert.equal(translate('es', 'nav.history'), 'Historial');
  assert.equal(translate('fr', 'nav.analytics'), 'Analyses');
});
