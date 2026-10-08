import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

test('locale migration grants only the required authenticated profile column', () => {
  const migration = fs.readFileSync(
    path.join(root, 'supabase/migrations/093_grant_profile_locale_preference.sql'),
    'utf8',
  );

  assert.match(migration, /grant update \(preferred_locale\) on table public\.profiles to authenticated/i);
  assert.match(migration, /revoke update \(preferred_locale\) on table public\.profiles from anon/i);
  assert.doesNotMatch(migration, /grant update on table public\.profiles/i);
});

test('language selector verifies persistence before changing the document locale', () => {
  const component = fs.readFileSync(
    path.join(root, 'components/i18n/LanguagePreference.tsx'),
    'utf8',
  );

  assert.match(component, /\.select\('preferred_locale'\)/);
  assert.match(component, /\.maybeSingle\(\)/);
  assert.match(component, /if \(error \|\| !data\)/);
  assert.match(component, /translate\(resolved, 'language\.failed'\)/);
});
