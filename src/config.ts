export type AppEnvironment = "local" | "stage" | "prod"

export type AppConfig = {
  environment: AppEnvironment
  aws: {
    region: string
    endpoint?: string
    forcePathStyle?: boolean
    credentials?: { accessKeyId: string; secretAccessKey: string }
  }
  gemini: {
    apiKey: string
    maxInputToken: number
    model: string
  }
  promptBucket: string
  llmTaskTable: string
  nationalDietApiEndpoint: string
  runApiKey: string
  localRunRange?: { from: string; until: string }
  cache: {
    dir?: string
    bypassOnce?: boolean
  }
}

const CONFIG_BY_ENV: Record<AppEnvironment, Omit<AppConfig, "environment">> = {
  local: {
    aws: {
      region: "ap-northeast-3",
      endpoint: "http://localstack:4566",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    },
    gemini: {
      apiKey: "local-dev-key",
      maxInputToken: 4096,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-prompts",
    llmTaskTable: "politopics-llm-tasks-local",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: "local-dev",
    localRunRange: { from: "2025-09-01", until: "2025-09-30" },
    cache: {},
  },
  stage: {
    aws: {
      region: "ap-northeast-3",
    },
    gemini: {
      apiKey: "REPLACE_ME",
      maxInputToken: 100000,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-data-collection-prompts-stage",
    llmTaskTable: "politopics-llm-tasks-stage",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: "REPLACE_ME",
    cache: {},
  },
  prod: {
    aws: {
      region: "ap-northeast-3",
    },
    gemini: {
      apiKey: "REPLACE_ME",
      maxInputToken: 100000,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-data-collection-prompts-production",
    llmTaskTable: "politopics-llm-tasks-production",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: "REPLACE_ME",
    cache: {},
  },
}

const ACTIVE_ENVIRONMENT: AppEnvironment = "local"

export let appConfig: AppConfig = {
  environment: ACTIVE_ENVIRONMENT,
  ...CONFIG_BY_ENV[ACTIVE_ENVIRONMENT],
}

export function setAppEnvironment(environment: AppEnvironment) {
  appConfig = {
    environment,
    ...CONFIG_BY_ENV[environment],
  }
}

export function setAppConfig(nextConfig: AppConfig) {
  appConfig = nextConfig
}

export function updateAppConfig(overrides: Partial<AppConfig>) {
  appConfig = {
    ...appConfig,
    ...overrides,
    aws: { ...appConfig.aws, ...overrides.aws },
    gemini: { ...appConfig.gemini, ...overrides.gemini },
    cache: { ...appConfig.cache, ...overrides.cache },
  }
}

export function consumeCacheBypass(): boolean {
  if (!appConfig.cache.bypassOnce) return false
  appConfig = {
    ...appConfig,
    cache: { ...appConfig.cache, bypassOnce: false },
  }
  return true
}
