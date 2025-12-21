import type { S3ClientConfig } from "@aws-sdk/client-s3"
import { appConfig } from "../config"

export function getAwsRegion(): string {
  return appConfig.aws.region
}

export function getAwsEndpoint(): string | undefined {
  return appConfig.aws.endpoint
}

export function getAwsClientConfig(): {
  region: string
  endpoint?: string
  credentials?: { accessKeyId: string; secretAccessKey: string }
} {
  const { region, endpoint, credentials } = appConfig.aws
  return endpoint ? { region, endpoint, credentials } : { region, credentials }
}

export function getAwsS3ClientConfig(): S3ClientConfig {
  const { region, endpoint, credentials, forcePathStyle } = appConfig.aws
  return {
    region,
    endpoint,
    credentials,
    forcePathStyle,
  }
}
