import type { AppConfig } from "../config"
import { appConfig, setAppConfig, setAppEnvironment, updateAppConfig } from "../config"

export type EnvMap = Record<string, string | undefined>

const DEFAULT_PROMPT_BUCKET = "politopics-data-collection-prompts-test"
const DEFAULT_ND_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
const DEFAULT_LOCALSTACK_URL = "http://localstack:4566"

const BASE_CONFIG: AppConfig = {
  ...appConfig,
  aws: { ...appConfig.aws },
  gemini: { ...appConfig.gemini },
  cache: { ...appConfig.cache },
}

const LAMBDA_ENV_DEFAULTS: EnvMap = {
  RUN_API_KEY: "secret",
  GEMINI_MAX_INPUT_TOKEN: "1200",
  GEMINI_API_KEY: "fake-key",
  PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
  NATIONAL_DIET_API_ENDPOINT: DEFAULT_ND_ENDPOINT,
}

const LOCALSTACK_ENV_DEFAULTS: EnvMap = {
  AWS_REGION: "ap-northeast-3",
  AWS_ACCESS_KEY_ID: "test",
  AWS_SECRET_ACCESS_KEY: "test",
}

function applyOverrides(values: EnvMap): void {
  const next: Partial<AppConfig> = {}
  const aws: NonNullable<AppConfig["aws"]> = { ...appConfig.aws }
  const gemini: NonNullable<AppConfig["gemini"]> = { ...appConfig.gemini }

  for (const [key, value] of Object.entries(values)) {
    if (!value) continue
    switch (key) {
      case "RUN_API_KEY":
        next.runApiKey = value
        break
      case "GEMINI_MAX_INPUT_TOKEN":
        gemini.maxInputToken = Number(value)
        break
      case "GEMINI_API_KEY":
        gemini.apiKey = value
        break
      case "PROMPT_BUCKET":
        next.promptBucket = value
        break
      case "NATIONAL_DIET_API_ENDPOINT":
        next.nationalDietApiEndpoint = value
        break
      case "LLM_TASK_TABLE":
        next.llmTaskTable = value
        break
      case "AWS_REGION":
        aws.region = value
        break
      case "LOCALSTACK_URL":
      case "AWS_ENDPOINT_URL":
        aws.endpoint = value
        aws.forcePathStyle = true
        break
      case "AWS_ACCESS_KEY_ID":
        aws.credentials = {
          accessKeyId: value,
          secretAccessKey: aws.credentials?.secretAccessKey ?? "test",
        }
        break
      case "AWS_SECRET_ACCESS_KEY":
        aws.credentials = {
          accessKeyId: aws.credentials?.accessKeyId ?? "test",
          secretAccessKey: value,
        }
        break
      default:
        break
    }
  }

  next.aws = aws
  next.gemini = gemini
  updateAppConfig(next)
}

export function resetTestConfig(): void {
  setAppConfig({
    ...BASE_CONFIG,
    aws: { ...BASE_CONFIG.aws },
    gemini: { ...BASE_CONFIG.gemini },
    cache: { ...BASE_CONFIG.cache },
  })
}

export function applyLambdaTestEnv(overrides: EnvMap = {}): void {
  setAppEnvironment("local")
  applyOverrides({ ...LAMBDA_ENV_DEFAULTS, ...overrides })
}

export function applyLocalstackEnv(overrides: EnvMap = {}): void {
  const { endpoint } = getLocalstackConfig()
  const currentRunKey = appConfig.runApiKey
  setAppEnvironment("local")
  if (currentRunKey) {
    updateAppConfig({ runApiKey: currentRunKey })
  }
  applyOverrides({
    ...LOCALSTACK_ENV_DEFAULTS,
    LOCALSTACK_URL: endpoint,
    AWS_ENDPOINT_URL: endpoint,
    ...overrides,
  })
}

export function getLocalstackConfig(): { endpoint: string; configured: boolean } {
  const endpoint = appConfig.aws.endpoint || DEFAULT_LOCALSTACK_URL
  return {
    endpoint,
    configured: Boolean(appConfig.aws.endpoint),
  }
}

export const TEST_DEFAULTS = {
  PROMPT_BUCKET: DEFAULT_PROMPT_BUCKET,
  NATIONAL_DIET_ENDPOINT: DEFAULT_ND_ENDPOINT,
  LOCALSTACK_URL: DEFAULT_LOCALSTACK_URL,
}
