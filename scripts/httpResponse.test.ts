import assert from 'node:assert/strict';
import test from 'node:test';
import { httpResponseDataToText } from '../src/lib/httpResponse.ts';

test('preserves text responses used by browser and text quote APIs', () => {
  assert.equal(httpResponseDataToText('v_usNOK="200~NOK~..."'), 'v_usNOK="200~NOK~..."');
});

test('serializes Capacitor native JSON responses back to parseable text', () => {
  const response = {
    data: {
      options: [{ option: 'NOK280121C00007000', last_trade_price: 4.95 }],
    },
  };

  assert.deepEqual(JSON.parse(httpResponseDataToText(response)), response);
});
