import type { S3ClientConfig } from "@aws-sdk/client-s3"

export type AppEnvironment = "local" | "stage" | "prod" | "ghaTest" | "localstackTest"

export type AppConfig = {
  environment: AppEnvironment
  aws: {
    region: string
    endpoint?: string
    forcePathStyle?: boolean
    credentials?: { accessKeyId: string; secretAccessKey: string }
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
    errorWebhook: string
    warnWebhook: string
    batchWebhook: string
  }
}

const CONFIG_BY_ENV: Record<AppEnvironment, () => Omit<AppConfig, "environment">> = {
  local: buildLocalConfig,
  stage: buildStageConfig,
  prod: buildProdConfig,
  ghaTest: buildTestConfig,
  localstackTest: buildTestConfig,
}

const ACTIVE_ENVIRONMENT: AppEnvironment = resolveEnvironment()

export let appConfig: AppConfig = {
  environment: ACTIVE_ENVIRONMENT,
  ...CONFIG_BY_ENV[ACTIVE_ENVIRONMENT](),
}

export function setAppEnvironment(environment: AppEnvironment) {
  appConfig = {
    environment,
    ...CONFIG_BY_ENV[environment](),
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

function buildLocalConfig(): Omit<AppConfig, "environment"> {
  return {
    aws: {
      region: "ap-northeast-3",
      endpoint: "http://localstack:4566",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    },
    promptBucket: "politopics-prompts",
    llmTaskTable: "politopics-llm-tasks-local",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    localRunRange: { from: "2025-09-01", until: "2025-09-30" },
    cache: {},
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  }
}

function buildStageConfig(): Omit<AppConfig, "environment"> {
  return {
    aws: {
      region: "ap-northeast-3",
    },
    promptBucket: "politopics-data-collection-prompts-stage",
    llmTaskTable: "politopics-llm-tasks-stage",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    cache: {},
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  }
}

function buildProdConfig(): Omit<AppConfig, "environment"> {
  return {
    aws: {
      region: "ap-northeast-3",
    },
    promptBucket: "politopics-data-collection-prompts-prod",
    llmTaskTable: "politopics-llm-tasks-prod",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: requireEnv("RUN_API_KEY"),
    cache: {},
    notifications: {
      errorWebhook: requireEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: requireEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: requireEnv("DISCORD_WEBHOOK_BATCH"),
    },
  }
}

function buildTestConfig(): Omit<AppConfig, "environment"> {
  const optionalEnv = (name: string) => requireEnv(name, true)
  return {
    aws: {
      region: process.env.AWS_REGION || "ap-northeast-3",
      endpoint: process.env.AWS_ENDPOINT_URL || "http://localhost:4566",
      forcePathStyle: true,
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    },
    promptBucket: "politopics-prompts",
    llmTaskTable: "politopics-llm-tasks-local",
    nationalDietApiEndpoint: "https://kokkai.ndl.go.jp/api/meeting",
    runApiKey: optionalEnv("RUN_API_KEY"),
    cache: {},
    notifications: {
      errorWebhook: optionalEnv("DISCORD_WEBHOOK_ERROR"),
      warnWebhook: optionalEnv("DISCORD_WEBHOOK_WARN"),
      batchWebhook: optionalEnv("DISCORD_WEBHOOK_BATCH"),
    },
  }
}

function requireEnv(name: string, allowMissing = false): string {
  // Tests use localstackTest/ghaTest and may not provision secrets; allow missing in that env.
  if (process.env.APP_ENVIRONMENT === "localstackTest" || process.env.APP_ENVIRONMENT === "ghaTest") {
    return process.env[name] ?? ""
  }
  const value = process.env[name]
  if (!value || value.trim() === "") {
    if (allowMissing) return ""
    throw new Error(`Environment variable ${name} is required`)
  }
  return value
}

function resolveEnvironment(): AppEnvironment {
  const value = process.env.APP_ENVIRONMENT ?? "local"
  if (value === "local" || value === "stage" || value === "prod" || value === "ghaTest" || value === "localstackTest") {
    return value
  }
  throw new Error(
    `Environment variable APP_ENVIRONMENT must be one of local, stage, prod, ghaTest, localstackTest (received: ${value})`,
  )
}
