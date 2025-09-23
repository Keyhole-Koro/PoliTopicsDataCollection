export function getAwsRegion(): string {
  return process.env.AWS_REGION || 'ap-northeast-3';
}

export function getAwsEndpoint(): string | undefined {
  const ep = process.env.AWS_ENDPOINT_URL;
  return ep && ep.trim().length ? ep : undefined;
}

export function getAwsClientConfig(): { region: string; endpoint?: string } {
  const region = getAwsRegion();
  const endpoint = getAwsEndpoint();
  return endpoint ? { region, endpoint } : { region };
}

