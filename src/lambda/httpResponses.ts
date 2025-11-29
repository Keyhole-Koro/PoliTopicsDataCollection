import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

export const resJson = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const isApiResponse = (value: unknown): value is APIGatewayProxyStructuredResultV2 => (
  typeof value === 'object' && value !== null && 'statusCode' in value
);
