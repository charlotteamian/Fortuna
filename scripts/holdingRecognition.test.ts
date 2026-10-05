import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import Dexie from 'dexie';
import {
  clearHoldingRecognitionConfig,
  HOLDING_RECOGNITION_MAX_IMAGE_BYTES,
  loadHoldingRecognitionConfig,
  recognizeHoldingScreenshot,
  saveHoldingRecognitionConfig,
  validateHoldingRecognitionConfig,
  type HoldingRecognitionConfig,
  type HoldingRecognitionRequest,
  type HoldingRecognitionTransport,
} from '../src/services/holdingRecognitionService.ts';

const image = { base64: 'AAAA', mimeType: 'image/png' };
const config = (protocol: HoldingRecognitionConfig['protocol'] = 'openai', baseUrl = 'https://vision.example/v1'): HoldingRecognitionConfig => ({
  protocol, baseUrl, model: 'vision-test', apiKey: 'private-test-key',
});
const output = { holdings: [{ name: '平安银行', symbol: '000001', market: 'A股', shares: 100, price: '12.3', costPrice: '10.5', costType: 'average' }], trades: [], warnings: [] };

function response(protocol: HoldingRecognitionConfig['protocol'], payload: unknown): unknown {
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  if (protocol === 'openai') return { choices: [{ message: { content: text } }] };
  if (protocol === 'gemini') return { candidates: [{ content: { parts: [{ text }] } }] };
  return { content: [{ type: 'text', text }] };
}

function mock(protocol: HoldingRecognitionConfig['protocol'], payload: unknown, inspect?: (request: HoldingRecognitionRequest) => void): HoldingRecognitionTransport {
  return async request => {
    inspect?.(request);
    return { status: 200, data: response(protocol, payload) };
  };
}

const expectCode = (code: string) => (error: unknown): boolean => {
  assert.equal((error as { code?: string }).code, code);
  assert.equal((error as Error).message, code);
  return true;
};

test('OpenAI compatible requests carry base64 vision input and preserve zero-prefixed symbols', async () => {
  const result = await recognizeHoldingScreenshot(config(), image, { transport: mock('openai', output, request => {
    assert.equal(request.url, 'https://vision.example/v1/chat/completions');
    assert.equal(request.headers.Authorization, 'Bearer private-test-key');
    assert.equal(request.timeoutMs, 90_000);
    const message = (request.body.messages as Array<{ content: unknown[] }>)[0];
    assert.deepEqual(message.content[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
    assert.equal(request.body.stream, false);
    const prompt = (message.content[1] as { text: string }).text;
    assert.match(prompt, /TOTAL owned\/held shares, not available\/sellable/);
    assert.match(prompt, /NEVER use a shared order\/委托编号/);
    assert.match(prompt, /never use today's date or infer a year/);
    assert.match(prompt, /Do not fabricate trades from a holding/);
    assert.match(prompt, /trades array MUST be chronological, earliest execution first/);
    assert.match(prompt, /visible full dates AND execution times when shown/);
    assert.match(prompt, /NEVER infer an ambiguous within-day sequence/);
    assert.match(prompt, /HOLDING_RECOGNITION_WARNING_TRADE_ORDER/);
  }) });
  assert.deepEqual(result.rows, [{ name: '平安银行', symbol: '000001', market: 'A股', shares: '100', price: '12.3', costPrice: '10.5' }]);
  assert.deepEqual(result.trades, []);
});

test('OpenAI full endpoints, trailing slashes and custom URL query parameters are retained', async () => {
  await recognizeHoldingScreenshot(config('openai', 'https://vision.example/api/chat/completions/?api-version=custom'), image, {
    transport: mock('openai', output, request => assert.equal(request.url, 'https://vision.example/api/chat/completions?api-version=custom')),
  });
  await recognizeHoldingScreenshot(config('openai', 'https://vision.example/'), image, {
    transport: mock('openai', output, request => assert.equal(request.url, 'https://vision.example/v1/chat/completions')),
  });
});

test('Gemini uses inlineData with header authentication and excludes thought text', async () => {
  const result = await recognizeHoldingScreenshot(config('gemini', 'https://vision.example/v1beta/'), image, {
    transport: async request => {
      assert.equal(request.url, 'https://vision.example/v1beta/models/vision-test:generateContent');
      assert.equal(request.headers['x-goog-api-key'], 'private-test-key');
      assert.equal(new URL(request.url).search, '');
      const parts = (request.body.contents as Array<{ parts: unknown[] }>)[0].parts;
      assert.deepEqual(parts[0], { inlineData: { mimeType: 'image/png', data: 'AAAA' } });
      return { status: 200, data: { candidates: [{ content: { parts: [
        { thought: true, text: 'internal reasoning is not JSON' },
        { text: JSON.stringify(output) },
      ] } }] } };
    },
  });
  assert.equal(result.rows[0].symbol, '000001');
});

test('Gemini supports origin, models base paths and complete endpoints without duplicating paths', async () => {
  const cases = [
    ['https://vision.example', 'https://vision.example/v1beta/models/vision-test:generateContent'],
    ['https://vision.example/v1beta/models/', 'https://vision.example/v1beta/models/vision-test:generateContent'],
    ['https://vision.example/proxy/models/specific:generateContent/', 'https://vision.example/proxy/models/specific:generateContent'],
  ];
  for (const [base, expected] of cases) {
    await recognizeHoldingScreenshot(config('gemini', base), image, { transport: mock('gemini', output, request => assert.equal(request.url, expected)) });
  }
});

test('Anthropic sends base64 image blocks and parses text blocks around thinking content', async () => {
  const result = await recognizeHoldingScreenshot(config('anthropic', 'https://vision.example/v1/messages/'), image, {
    transport: async request => {
      assert.equal(request.url, 'https://vision.example/v1/messages');
      assert.equal(request.headers['x-api-key'], 'private-test-key');
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
      const blocks = (request.body.messages as Array<{ content: unknown[] }>)[0].content;
      assert.deepEqual(blocks[0], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } });
      return { status: 200, data: JSON.stringify({ content: [
        { type: 'thinking', thinking: 'ignore' },
        { type: 'text', text: '```json\n' + JSON.stringify(output) + '\n```' },
      ] }) };
    },
  });
  assert.equal(result.rows[0].costPrice, '10.5');
});

test('unknown fields stay blank, valid zero stays zero, bad commas and negative amounts do not become numbers', async () => {
  const payload = { holdings: [
    { name: 'missing', symbol: '00700', market: 'HK Stock', shares: null, price: null, costPrice: null },
    { name: 'explicit zero', symbol: '000001', shares: 0, price: '0', costPrice: 0, costType: 'average' },
    { name: 'bad number', symbol: 1, market: 'invented', shares: '1,2', price: '-2', costPrice: false },
    { name: 'grouped number', symbol: 'AAPL', market: 'US', shares: '1,200.5', price: '２３.５' },
  ], trades: [], warnings: [] };
  const result = await recognizeHoldingScreenshot(config(), image, { transport: mock('openai', payload) });
  assert.deepEqual(result.rows[0], { name: 'missing', symbol: '00700', market: '港股', shares: '', price: '', costPrice: '' });
  assert.deepEqual(result.rows[1], { name: 'explicit zero', symbol: '000001', market: '', shares: '0', price: '0', costPrice: '0' });
  assert.equal(result.rows[2].symbol, '');
  assert.equal(result.rows[2].market, '');
  assert.equal(result.rows[2].shares, '');
  assert.equal(result.rows[2].price, '');
  assert.equal(result.rows[3].shares, '1200.5');
  assert.equal(result.rows[3].price, '23.5');
});

test('unknown or diluted costs are left blank and derivative holdings are excluded', async () => {
  const payload = { holdings: [
    { ...output.holdings[0], costType: 'diluted' },
    { ...output.holdings[0], costType: 'unknown' },
    { ...output.holdings[0], instrumentType: 'option' },
    { ...output.holdings[0], symbol: 'AAPL261218C00150000' },
  ], trades: [] };
  const result = await recognizeHoldingScreenshot(config(), image, { transport: mock('openai', payload) });
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[0].costPrice, '');
  assert.equal(result.rows[1].costPrice, '');
  assert.ok(result.warnings.includes('HOLDING_RECOGNITION_WARNING_COST_DILUTED'));
  assert.ok(result.warnings.includes('HOLDING_RECOGNITION_WARNING_COST_UNKNOWN'));
  assert.ok(result.warnings.includes('HOLDING_RECOGNITION_WARNING_DERIVATIVES'));
});

test('trade-only screenshots preserve separate buy/sell executions without inventing holdings', async () => {
  const payload = { trades: [
    { name: '平安银行', symbol: '000001', market: 'A股', date: '2026-10-01', kind: 'buy', shares: 100, price: '12', brokerRef: '000123', executionStatus: 'filled' },
    { name: '平安银行', symbol: '000001', market: 'A股', date: '2026/10/02', kind: '卖出', shares: '20', price: 13 },
  ], warnings: ['只显示部分成交记录。'] };
  const result = await recognizeHoldingScreenshot(config(), image, { transport: mock('openai', payload) });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.trades, [
    { name: '平安银行', symbol: '000001', market: 'A股', date: '2026-10-01', kind: 'buy', shares: '100', price: '12', brokerRef: '000123' },
    { name: '平安银行', symbol: '000001', market: 'A股', date: '2026-10-02', kind: 'sell', shares: '20', price: '13' },
  ]);
  assert.deepEqual(result.warnings, ['只显示部分成交记录。']);
});

test('ambiguous dates, unknown directions, negative trades and unfilled orders stay unconfirmed', async () => {
  const payload = { holdings: [], trades: [
    { name: 'A', symbol: 'AAPL', date: '10-05', kind: 'transfer', shares: -100, price: -10 },
    { name: 'B', symbol: 'AAPL', date: '2026-02-30', kind: 'buy', shares: 10, price: 20 },
    { name: 'C', symbol: 'AAPL', date: '2024年2月29日', kind: 'sell', shares: 10, price: 20 },
    { name: 'D', symbol: 'AAPL', date: '2026-10-05', kind: 'buy', shares: 10, price: 20, executionStatus: 'pending' },
    { name: 'E', symbol: 'AAPL', date: '2026-10-05', kind: 'buy', shares: 10, price: 20, executionStatus: 'unknown' },
  ] };
  const result = await recognizeHoldingScreenshot(config(), image, { transport: mock('openai', payload) });
  assert.equal(result.trades.length, 4);
  assert.deepEqual(result.trades[0], { name: 'A', symbol: 'AAPL', market: '', date: '', kind: '', shares: '', price: '' });
  assert.equal(result.trades[1].date, '');
  assert.equal(result.trades[2].date, '2024-02-29');
  assert.equal(result.trades[3].shares, '');
  assert.equal(result.trades[3].price, '');
});

test('explicit foreign-currency prices are blanked instead of being interpreted in the account currency', async () => {
  const payload = { holdings: [
    { ...output.holdings[0], currency: 'HKD' },
    { ...output.holdings[0], currency: '人民币' },
  ], trades: [{ name: 'AAPL', symbol: 'AAPL', date: '2026-10-01', kind: 'buy', shares: 100, price: 20, currency: 'USD' }] };
  const result = await recognizeHoldingScreenshot(config(), image, { accountCurrency: 'CNY', transport: mock('openai', payload) });
  assert.equal(result.rows[0].price, '');
  assert.equal(result.rows[0].costPrice, '');
  assert.equal(result.rows[1].price, '12.3');
  assert.equal(result.trades[0].price, '');
  assert.ok(result.warnings.includes('HOLDING_RECOGNITION_WARNING_CURRENCY'));
});

test('invalid or missing configuration, insecure URLs and invalid image data never invoke transport', async () => {
  let requests = 0;
  const transport = async () => { requests++; return { status: 200, data: response('openai', output) }; };
  for (const baseUrl of ['http://vision.example/v1', 'https://user:password@vision.example/v1', 'file:///tmp/image', 'https://vision.example/#fragment']) {
    await assert.rejects(recognizeHoldingScreenshot(config('openai', baseUrl), image, { transport }), expectCode('HOLDING_RECOGNITION_URL'));
  }
  await assert.rejects(recognizeHoldingScreenshot({ ...config(), apiKey: '' }, image, { transport }), expectCode('HOLDING_RECOGNITION_CONFIG'));
  await assert.rejects(recognizeHoldingScreenshot({ ...config(), apiKey: 'key\nsecret' }, image, { transport }), expectCode('HOLDING_RECOGNITION_CONFIG'));
  await assert.rejects(recognizeHoldingScreenshot(config(), { base64: 'invalid!', mimeType: 'image/png' }, { transport }), expectCode('HOLDING_RECOGNITION_IMAGE'));
  assert.equal(requests, 0);
  assert.equal(validateHoldingRecognitionConfig(config('openai', 'http://127.0.0.1:9000/v1')).baseUrl, 'http://127.0.0.1:9000/v1');
  assert.equal(validateHoldingRecognitionConfig(config('openai', 'http://[::1]:9000/v1')).baseUrl, 'http://[::1]:9000/v1');
});

test('oversized screenshots are rejected before sending any HTTP request', async () => {
  const base64 = 'A'.repeat(4 * Math.ceil((HOLDING_RECOGNITION_MAX_IMAGE_BYTES + 1) / 3));
  await assert.rejects(recognizeHoldingScreenshot(config(), { base64, mimeType: 'image/jpeg' }, {
    transport: async () => { assert.fail('transport must not run'); },
  }), expectCode('HOLDING_RECOGNITION_TOO_LARGE'));
});

test('provider auth/limit/HTTP errors and transport exceptions never expose raw body or API key', async () => {
  for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMIT'], [500, 'HTTP']] as const) {
    await assert.rejects(recognizeHoldingScreenshot(config(), image, {
      transport: async () => ({ status, data: 'private-test-key with full account contents' }),
    }), expectCode(`HOLDING_RECOGNITION_${code}`));
  }
  await assert.rejects(recognizeHoldingScreenshot(config(), image, {
    transport: async () => { throw new Error('private-test-key'); },
  }), expectCode('HOLDING_RECOGNITION_NETWORK'));
});

test('recognition times out with an aborted signal and a safe stable error', async () => {
  let signal: AbortSignal | undefined;
  await assert.rejects(recognizeHoldingScreenshot(config(), image, {
    timeoutMs: 5,
    transport: request => { signal = request.signal; return new Promise(() => {}); },
  }), expectCode('HOLDING_RECOGNITION_TIMEOUT'));
  assert.equal(signal?.aborted, true);
});

test('malformed JSON, wrong schemas and non-text API responses are rejected', async () => {
  for (const payload of ['broken JSON', '{}', '{"holdings":{}}', '{"holdings":[],"trades":"bad"}', '{"holdings":[true]}']) {
    await assert.rejects(recognizeHoldingScreenshot(config(), image, { transport: mock('openai', payload) }), expectCode('HOLDING_RECOGNITION_RESPONSE'));
  }
  await assert.rejects(recognizeHoldingScreenshot(config(), image, {
    transport: async () => ({ status: 200, data: { choices: [{ message: { content: null } }] } }),
  }), expectCode('HOLDING_RECOGNITION_RESPONSE'));
});

test('API settings persist in their own Dexie database and never write a ledger table', async () => {
  const ledger = new Dexie('FortunaRecognitionLedgerIsolationTest');
  ledger.version(1).stores({ accounts: 'id' });
  await ledger.table('accounts').put({ id: 'untouched', amount: 123 });
  await clearHoldingRecognitionConfig();
  assert.equal(await loadHoldingRecognitionConfig(), null);
  await saveHoldingRecognitionConfig(config('gemini'));
  assert.deepEqual(await loadHoldingRecognitionConfig(), config('gemini'));
  assert.deepEqual(await ledger.table('accounts').toArray(), [{ id: 'untouched', amount: 123 }]);
  await clearHoldingRecognitionConfig();
  assert.equal(await loadHoldingRecognitionConfig(), null);
  ledger.close();
  await Dexie.delete('FortunaRecognitionLedgerIsolationTest');
});
