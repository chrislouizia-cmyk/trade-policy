import fs from 'node:fs';
import assert from 'node:assert/strict';

const {PGlite}=await import(process.argv[2]);
const migration=fs.readFileSync(process.argv[3],'utf8');
const db=new PGlite();
try {
  await db.exec(`create table public.trader_intelligence_profiles(user_id text primary key,timezone text not null default 'UTC',last_seen_at timestamptz);
    insert into public.trader_intelligence_profiles values('legacy','Europe/Paris',now()),('new','UTC',null),('other','Asia/Tokyo',now());`);
  await db.exec(migration);
  assert.equal((await db.query("select timezone_source from public.trader_intelligence_profiles where user_id='legacy'")).rows[0].timezone_source,'DEVICE');
  assert.equal((await db.query("select timezone_source from public.trader_intelligence_profiles where user_id='new'")).rows[0].timezone_source,'UNSET');
  await db.exec("update public.trader_intelligence_profiles set timezone='America/Monterrey',timezone_source='DEVICE' where user_id='new' and timezone_source='UNSET';");
  await db.exec("update public.trader_intelligence_profiles set timezone='America/Los_Angeles',timezone_source='DEVICE' where user_id='new' and timezone_source='UNSET';");
  assert.equal((await db.query("select timezone from public.trader_intelligence_profiles where user_id='new'")).rows[0].timezone,'America/Monterrey');
  await db.exec("update public.trader_intelligence_profiles set timezone='Europe/London',timezone_source='USER' where user_id='new';");
  await db.exec("update public.trader_intelligence_profiles set timezone='America/Los_Angeles',timezone_source='DEVICE' where user_id='new' and timezone_source='UNSET';");
  assert.equal((await db.query("select timezone from public.trader_intelligence_profiles where user_id='new'")).rows[0].timezone,'Europe/London');
  assert.equal((await db.query("select timezone from public.trader_intelligence_profiles where user_id='other'")).rows[0].timezone,'Asia/Tokyo');
  await assert.rejects(db.exec("update public.trader_intelligence_profiles set timezone_source='INVALID' where user_id='new';"));
  console.log('Timezone SQL verified: legacy preservation, first capture, stale-device exclusion, explicit choice and user isolation.');
} finally {await db.close();}
