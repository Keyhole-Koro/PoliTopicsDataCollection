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
  notifications: {
    errorWebhook?: string
    warnWebhook?: string
    batchWebhook?: string
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
      apiKey: requireEnv("GEMINI_API_KEY"),
      maxInputToken: 4096,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-prompts",
    llmTaskTable: "politopics-llm-tasks-local",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    localRunRange: { from: "2025-09-01", until: "2025-09-30" },
    cache: {},
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
  stage: {
    aws: {
      region: "ap-northeast-3",
    },
    gemini: {
      apiKey: requireEnv("GEMINI_API_KEY"),
      maxInputToken: 100000,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-data-collection-prompts-stage",
    llmTaskTable: "politopics-llm-tasks-stage",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    cache: {},
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
  prod: {
    aws: {
      region: "ap-northeast-3",
    },
    gemini: {
      apiKey: requireEnv("GEMINI_API_KEY"),
      maxInputToken: 100000,
      model: "gemini-2.5-flash",
    },
    promptBucket: "politopics-data-collection-prompts-prod",
    llmTaskTable: "politopics-llm-tasks-prod",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    cache: {},
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH"),
    },
  },
}

const ACTIVE_ENVIRONMENT: AppEnvironment = resolveEnvironment()

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

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value || value.trim() === "") {
    throw new Error(`Environment variable ${name} is required`)
  }
  return value
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]
  if (!value || value.trim() === "") return undefined
  return value
}

function resolveEnvironment(): AppEnvironment {
  const value = process.env.APP_ENVIRONMENT ?? "local"
  if (value === "local" || value === "stage" || value === "prod") {
    return value
  }
  throw new Error(
    `Environment variable APP_ENVIRONMENT must be one of local, stage, prod (received: ${value})`,
  )
}
