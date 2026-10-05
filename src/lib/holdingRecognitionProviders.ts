import type { HoldingRecognitionConfig } from '../services/holdingRecognitionService';

export type HoldingRecognitionProviderId =
  | 'aliyun' | 'zhipu' | 'moonshot' | 'volcengine' | 'openai' | 'gemini' | 'anthropic' | 'custom';

export interface HoldingRecognitionProvider {
  id: HoldingRecognitionProviderId;
  nameKey: string;
  protocol: HoldingRecognitionConfig['protocol'];
  baseUrl: string;
  defaultModel: string;
  models: readonly string[];
  documentationUrl: string;
  imageLimitBytes?: number;
  imageMimeTypes?: readonly string[];
}

/** Official vision endpoints and currently documented models, checked on 2026-10-05.
 * These are editable suggestions, not a promise that a model is enabled for a user's API key.
 */
export const HOLDING_RECOGNITION_PROVIDERS: readonly HoldingRecognitionProvider[] = [
  {
    id: 'aliyun', nameKey: 'holding_provider_aliyun', protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen3-vl-flash',
    models: ['qwen3-vl-flash', 'qwen3-vl-plus', 'qwen-vl-plus', 'qwen-vl-max'],
    documentationUrl: 'https://help.aliyun.com/zh/model-studio/vision',
  },
  {
    id: 'zhipu', nameKey: 'holding_provider_zhipu', protocol: 'openai',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4.6v-flash',
    models: ['glm-4.6v-flash', 'glm-4.6v', 'glm-4.6v-flashx', 'glm-5v-turbo'],
    documentationUrl: 'https://docs.bigmodel.cn/cn/guide/models/vlm/glm-4.6v',
    imageLimitBytes: 5 * 1024 * 1024, imageMimeTypes: ['image/jpeg', 'image/png'],
  },
  {
    id: 'moonshot', nameKey: 'holding_provider_moonshot', protocol: 'openai',
    baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'kimi-k2.6',
    // K2.5 and moonshot-v1 vision were retired on 2026-08-31; do not suggest them.
    models: ['kimi-k2.6', 'kimi-k3'],
    documentationUrl: 'https://platform.kimi.com/docs/guide/use-kimi-vision-model',
  },
  {
    id: 'volcengine', nameKey: 'holding_provider_volcengine', protocol: 'openai',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: 'doubao-seed-2-1-pro-260628',
    // The editable model input also accepts the user's vision-enabled ep-... endpoint ID.
    models: ['doubao-seed-2-1-pro-260628'],
    documentationUrl: 'https://docs.volcengine.com/docs/ark/image-understanding',
  },
  {
    id: 'openai', nameKey: 'holding_provider_openai', protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', models: ['gpt-4.1-mini', 'gpt-4.1'],
    documentationUrl: 'https://developers.openai.com/api/docs/guides/images-vision',
  },
  {
    id: 'gemini', nameKey: 'holding_provider_gemini', protocol: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-3.8-flash', models: ['gemini-3.8-flash'],
    documentationUrl: 'https://ai.google.dev/gemini-api/docs/image-understanding',
  },
  {
    id: 'anthropic', nameKey: 'holding_provider_anthropic', protocol: 'anthropic',
    baseUrl: 'https://api.anthropic.com', defaultModel: 'claude-sonnet-4-6', models: ['claude-sonnet-4-6'],
    documentationUrl: 'https://platform.claude.com/docs/en/build-with-claude/vision',
  },
  {
    id: 'custom', nameKey: 'holding_provider_custom', protocol: 'openai',
    baseUrl: '', defaultModel: '', models: [], documentationUrl: '',
  },
];

export function getHoldingRecognitionProvider(id: string): HoldingRecognitionProvider {
  return HOLDING_RECOGNITION_PROVIDERS.find(provider => provider.id === id)
    ?? HOLDING_RECOGNITION_PROVIDERS.find(provider => provider.id === 'custom')!;
}

/** Explicit selection survives custom proxy URLs; legacy settings are inferred by hostname. */
export function inferHoldingRecognitionProvider(config: Pick<HoldingRecognitionConfig, 'protocol' | 'baseUrl' | 'provider'>): HoldingRecognitionProviderId {
  if (config.provider && HOLDING_RECOGNITION_PROVIDERS.some(provider => provider.id === config.provider)) {
    return config.provider as HoldingRecognitionProviderId;
  }
  let hostname: string;
  try { hostname = new URL(config.baseUrl).hostname.toLowerCase(); } catch { return 'custom'; }
  if (config.protocol === 'openai') {
    if (hostname === 'dashscope.aliyuncs.com' || hostname === 'dashscope-intl.aliyuncs.com'
      || hostname.endsWith('.maas.aliyuncs.com')) return 'aliyun';
    if (hostname === 'open.bigmodel.cn') return 'zhipu';
    if (hostname === 'api.moonshot.cn' || hostname === 'api.moonshot.ai') return 'moonshot';
    if (/^ark\.[a-z0-9-]+\.volces\.com$/.test(hostname)) return 'volcengine';
    if (hostname === 'api.openai.com') return 'openai';
  }
  if (config.protocol === 'gemini' && hostname === 'generativelanguage.googleapis.com') return 'gemini';
  if (config.protocol === 'anthropic' && hostname === 'api.anthropic.com') return 'anthropic';
  return 'custom';
}

/** Keep vendor-specific flags out of other APIs and out of incompatible model families. */
export function holdingRecognitionProviderBody(config: HoldingRecognitionConfig): Record<string, unknown> {
  if (config.protocol !== 'openai') return {};
  const provider = inferHoldingRecognitionProvider(config);
  const model = config.model.toLowerCase();
  if (provider === 'aliyun' && /^qwen3(?:-vl-(?:flash|plus)|\.[5-8])/.test(model) && !/(?:^|-)thinking(?:-|$)/.test(model)) {
    // https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions
    return { enable_thinking: false };
  }
  if (provider === 'zhipu' && /^glm-(?:4\.[56]v|5v)/.test(model)) {
    // https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode
    return { thinking: { type: 'disabled' } };
  }
  if (provider === 'moonshot') {
    // K2.6 allows instant mode; K3 uses reasoning_effort and does not share the same flags.
    if (/^kimi-k2\.[56](?:$|-)/.test(model)) return { thinking: { type: 'disabled' } };
    if (/^kimi-k3(?:$|-)/.test(model)) return { reasoning_effort: 'low' };
  }
  if (provider === 'volcengine' && (/^doubao-seed-(?:2|1-6)/.test(model) || /^ep-/.test(model))) {
    // https://docs.volcengine.com/docs/ark/deep-thinking
    return { thinking: { type: 'disabled' } };
  }
  return {};
}
