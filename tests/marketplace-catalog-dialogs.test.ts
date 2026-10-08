import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=(file:string)=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const lab=read('components/hq/MarketplaceLab.tsx');
const detail=read('components/hq/MarketplaceReleaseDetail.tsx');
const api=read('app/api/hq/marketplace/route.ts');

test('qualification details open in a dismissible viewport modal instead of expanding candidate cards',()=>{
  assert.match(lab,/View qualification details/);
  assert.match(lab,/role="dialog" aria-modal="true" aria-labelledby="qualification-detail-title"/);
  assert.match(lab,/Close qualification details/);
  assert.match(lab,/setSelectedCandidateId\(null\)/);
  assert.doesNotMatch(lab,/\{isSelected\?<div className="marketplace-candidate-details"/);
});

test('candidate catalog starts with the ten most ready strategies and expands deliberately',()=>{
  assert.match(lab,/CATALOG_PAGE_SIZE = 10/);
  assert.match(lab,/candidateReadinessScore/);
  assert.match(lab,/visibleCandidates = rankedCandidates\.slice\(0, visibleCandidateCount\)/);
  assert.match(lab,/View more strategies/);
  assert.match(lab,/Show top 10/);
});

test('listing cards open the complete existing evidence view in a modal',()=>{
  assert.match(lab,/View full strategy/);
  assert.match(lab,/MarketplaceReleaseDetail listingId=\{selectedListingId\} embedded/);
  assert.match(lab,/Close strategy details/);
  assert.match(detail,/embedded=false/);
});

test('duplicate revisions identify and link the exact existing listing',()=>{
  assert.match(api,/existingInternalTestListing/);
  assert.match(api,/source_strategy_revision_id/);
  assert.match(api,/existingListing:/);
  assert.match(lab,/Open existing listing/);
  assert.match(lab,/This exact revision already exists as/);
});
