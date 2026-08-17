import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const validator=readFileSync('components/TradeValidator.tsx','utf8');
const styles=readFileSync('app/trade-police.css','utf8');

test('trade action modal is portalled to document.body with locked background scrolling',()=>{
  assert.match(validator,/import \{ createPortal \} from 'react-dom'/);
  assert.match(validator,/createPortal\(<div className="reasoning-modal-backdrop"[\s\S]*document\.body\)/);
  assert.match(validator,/document\.body\.style\.overflow='hidden'/);
  assert.match(styles,/\.reasoning-modal-backdrop\s*\{[\s\S]*position:\s*fixed;[\s\S]*inset:\s*0;[\s\S]*z-index:\s*2147483000;[\s\S]*display:\s*grid;[\s\S]*place-items:\s*center/);
  assert.match(styles,/\.reasoning-modal\s*\{[\s\S]*max-height:\s*calc\(100dvh - 32px\)/);
});
