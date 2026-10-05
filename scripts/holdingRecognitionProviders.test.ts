import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getHoldingRecognitionProvider,
  HOLDING_RECOGNITION_PROVIDERS,
  holdingRecognitionProviderBody,
  inferHoldingRecognitionProvider,
} from '../src/lib/holdingRecognitionProviders.ts';
import {
  clearHoldingRecognitionConfig,
  loadHoldingRecognitionConfig,
  recognizeHoldingScreenshot,
  saveHoldingRecognitionConfig,
  type HoldingRecognitionConfig,
} from '../src/services/holdingRecognitionService.ts';

const image = { base64: 'AAAA', mimeType: 'image/png' };
const extracted = { holdings: [{ name: '平安银行', symbol: '000001', market: 'A股', shares: 100, price: 12 }], trades: [], warnings: [] };
const responseData = { choices: [{ message: { content: JSON.stringify(extracted) }, finish_reason: 'stop' }] };

function presetConfig(id: string): HoldingRecognitionConfig {
  const preset = getHoldingRecognitionProvider(id);
  return { provider: preset.id, protocol: preset.protocol, baseUrl: preset.baseUrl, model: preset.defaultModel, apiKey: 'fake-provider-test-key' };
}

test('presets expose domestic vision providers first and keep existing protocols and custom APIs', () => {
  assert.deepEqual(HOLDING_RECOGNITION_PROVIDERS.map(provider => provider.id), [
    'aliyun', 'zhipu', 'moonshot', 'volcengine', 'openai', 'gemini', 'anthropic', 'custom',
  ]);
  for (const provider of HOLDING_RECOGNITION_PROVIDERS) {
    assert.equal(provider.nameKey, `holding_provider_${provider.id}`);
    if (provider.id !== 'custom') {
      assert.equal(new URL(provider.baseUrl).protocol, 'https:');
      assert.equal(new URL(provider.documentationUrl).protocol, 'https:');
      assert.ok(provider.models.includes(provider.defaultModel));
    }
  }
  assert.equal(getHoldingRecognitionProvider('unrecognised-provider').id, 'custom');
  assert.equal(getHoldingRecognitionProvider('aliyun').defaultModel, 'qwen3-vl-flash');
  assert.equal(getHoldingRecognitionProvider('zhipu').defaultModel, 'glm-4.6v-flash');
  assert.equal(getHoldingRecognitionProvider('moonshot').defaultModel, 'kimi-k2.6');
  assert.equal(getHoldingRecognitionProvider('volcengine').defaultModel, 'doubao-seed-2-1-pro-260628');
  assert.ok(!getHoldingRecognitionProvider('moonshot').models.some(model => /k2\.5|moonshot-v1/.test(model)));
  assert.ok(!getHoldingRecognitionProvider('zhipu').models.includes('glm-4v-flash'));
});

test('legacy configurations infer providers from exact official hosts and allow workspace endpoints', () => {
  for (const provider of HOLDING_RECOGNITION_PROVIDERS.filter(provider => provider.id !== 'custom')) {
    assert.equal(inferHoldingRecognitionProvider({ protocol: provider.protocol, baseUrl: provider.baseUrl }), provider.id);
  }
  assert.equal(inferHoldingRecognitionProvider({ protocol: 'openai', baseUrl: 'https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions' }), 'aliyun');
  assert.equal(inferHoldingRecognitionProvider({ protocol: 'openai', baseUrl: 'https://api.moonshot.ai/v1' }), 'moonshot');
  assert.equal(inferHoldingRecognitionProvider({ protocol: 'openai', baseUrl: 'https://api.moonshot.cn.evil.example/v1' }), 'custom');
  assert.equal(inferHoldingRecognitionProvider({ protocol: 'openai', baseUrl: 'https://example.test/api?url=api.openai.com' }), 'custom');
  assert.equal(inferHoldingRecognitionProvider({ protocol: 'gemini', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }), 'custom');
});

test('explicit provider selection keeps flags for proxies and custom selection preserves generic requests', () => {
  const qwen = { ...presetConfig('aliyun'), baseUrl: 'https://my-proxy.example/v1' };
  assert.equal(inferHoldingRecognitionProvider(qwen), 'aliyun');
  assert.deepEqual(holdingRecognitionProviderBody(qwen), { enable_thinking: false });
  assert.equal(inferHoldingRecognitionProvider({ ...qwen, provider: 'custom' }), 'custom');
  assert.deepEqual(holdingRecognitionProviderBody({ ...qwen, provider: 'custom' }), {});
  assert.deepEqual(holdingRecognitionProviderBody({ ...qwen, model: 'qwen3-vl-235b-a22b-thinking' }), {});
  assert.deepEqual(holdingRecognitionProviderBody({ ...qwen, model: 'qwen-vl-plus' }), {});
  assert.deepEqual(holdingRecognitionProviderBody({ ...qwen, protocol: 'anthropic' }), {});
});

test('Kimi model-specific settings do not inject invalid temperature or thinking flags', () => {
  assert.deepEqual(holdingRecognitionProviderBody(presetConfig('moonshot')), { thinking: { type: 'disabled' } });
  assert.deepEqual(holdingRecognitionProviderBody({ ...presetConfig('moonshot'), model: 'kimi-k3' }), { reasoning_effort: 'low' });
  assert.deepEqual(holdingRecognitionProviderBody({ ...presetConfig('moonshot'), model: 'kimi-k2.7-code' }), {});
  assert.deepEqual(holdingRecognitionProviderBody({ ...presetConfig('volcengine'), model: 'ep-user-vision-model' }), { thinking: { type: 'disabled' } });
});

test('all four domestic presets send documented vision shapes with editable models and safe headers', async () => {
  let requestCount = 0;
  for (const id of ['aliyun', 'zhipu', 'moonshot', 'volcengine']) {
    const config = presetConfig(id);
    const result = await recognizeHoldingScreenshot(config, image, { transport: async request => {
      requestCount++;
      assert.equal(request.url, `${config.baseUrl}/chat/completions`);
      assert.equal(request.headers.Authorization, 'Bearer fake-provider-test-key');
      assert.equal(request.headers['Content-Type'], 'application/json');
      assert.equal(request.timeoutMs, 90_000);
      const body = request.body;
      assert.equal(body.model, config.model);
      assert.equal(body.stream, false);
      assert.equal(body.temperature, undefined);
      assert.equal(body.top_p, undefined);
      const content = (body.messages as Array<{ content: Array<Record<string, unknown>> }>)[0].content;
      assert.deepEqual(content[0], { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } });
      if (id === 'aliyun') assert.equal(body.enable_thinking, false);
      else assert.deepEqual(body.thinking, { type: 'disabled' });
      return { status: 200, data: responseData };
    } });
    assert.equal(result.rows[0].symbol, '000001');
    assert.equal(result.rows[0].shares, '100');
  }
  assert.equal(requestCount, 4);
});

test('proxy and full endpoint overrides retain provider flags without changing request destination', async () => {
  const config = { ...presetConfig('moonshot'), baseUrl: 'https://my-proxy.example/custom/chat/completions/', model: 'kimi-k3' };
  await recognizeHoldingScreenshot(config, image, { transport: async request => {
    assert.equal(request.url, 'https://my-proxy.example/custom/chat/completions');
    assert.equal(request.body.model, 'kimi-k3');
    assert.equal(request.body.reasoning_effort, 'low');
    assert.equal(request.body.thinking, undefined);
    return { status: 200, data: responseData };
  } });
  await recognizeHoldingScreenshot({ ...presetConfig('volcengine'), model: 'ep-my-vision-endpoint' }, image, { transport: async request => {
    assert.equal(request.body.model, 'ep-my-vision-endpoint');
    assert.deepEqual(request.body.thinking, { type: 'disabled' });
    return { status: 200, data: responseData };
  } });
});

test('Zhipu rejects unsupported formats and images larger than its documented limit before transport', async () => {
  const transport = async () => { assert.fail('unsupported image must not be sent'); };
  await assert.rejects(recognizeHoldingScreenshot(presetConfig('zhipu'), { ...image, mimeType: 'image/webp' }, { transport }), { code: 'HOLDING_RECOGNITION_IMAGE' });
  const base64 = 'A'.repeat(4 * Math.ceil((5 * 1024 * 1024 + 1) / 3));
  await assert.rejects(recognizeHoldingScreenshot(presetConfig('zhipu'), { ...image, base64 }, { transport }), { code: 'HOLDING_RECOGNITION_TOO_LARGE' });
});

test('provider selection persists separately from the ledger and old configs still load unchanged', async () => {
  await clearHoldingRecognitionConfig();
  const saved = { ...presetConfig('aliyun'), baseUrl: 'https://my-proxy.example/v1' };
  await saveHoldingRecognitionConfig(saved);
  assert.deepEqual(await loadHoldingRecognitionConfig(), saved);
  const legacy = { ...saved };
  delete legacy.provider;
  await saveHoldingRecognitionConfig(legacy);
  assert.deepEqual(await loadHoldingRecognitionConfig(), legacy);
  await clearHoldingRecognitionConfig();
});
