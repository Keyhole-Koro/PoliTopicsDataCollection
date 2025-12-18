export type EnvMap = Record<string, string | undefined>;

const DEFAULT_PROMPT_BUCKET = 'politopics-data-collection-prompts-test';
const DEFAULT_ND_ENDPOINT = 'https://kokkai.ndl.go.jp/api/meeting';
const DEFAULT_LOCALSTACK_URL = 'http://localstack:4566';

const LAMBDA_ENV_DEFAULTS: EnvMap = {
  RUN_API_KEY: 'secret',
  GEMINI_MAX_INPUT_TOKEN: '1200',
  GEMINI_API_KEY: 'fake-key',
  PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
  NATIONAL_DIET_API_ENDPOINT: DEFAULT_ND_ENDPOINT,
};

const LOCALSTACK_ENV_DEFAULTS: EnvMap = {
  AWS_REGION: 'ap-northeast-3',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
};

function assignEnv(values: EnvMap): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

export function applyLambdaTestEnv(overrides: EnvMap = {}): void {
  assignEnv({ ...LAMBDA_ENV_DEFAULTS, ...overrides });
}

export function applyLocalstackEnv(overrides: EnvMap = {}): void {
  const { endpoint } = getLocalstackConfig();
  assignEnv({
    ...LOCALSTACK_ENV_DEFAULTS,
    LOCALSTACK_URL: endpoint,
    AWS_ENDPOINT_URL: endpoint,
    ...overrides,
  });
}

export function getLocalstackConfig(): { endpoint: string; configured: boolean } {
  const envEndpoint = process.env.LOCALSTACK_URL;
  return {
    endpoint: envEndpoint || DEFAULT_LOCALSTACK_URL,
    configured: Boolean(envEndpoint),
  };
}

export const TEST_DEFAULTS = {
  PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
  NATIONAL_DIET_ENDPOINT: DEFAULT_ND_ENDPOINT,
  LOCALSTACK_URL: DEFAULT_LOCALSTACK_URL,
};
