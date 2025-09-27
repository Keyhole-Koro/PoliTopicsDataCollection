import 'dotenv/config';
import { handler } from './lambda_handler';
import type { ScheduledEvent } from 'aws-lambda';

(async () => {
  // Minimal ScheduledEvent-like object
  const event: ScheduledEvent = { source: 'local.events' } as any;

  process.env.NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting";

  process.env.FROM_DATE = '2025-08-01';
  process.env.UNTIL_DATE = '2025-08-10';

  // Local defaults (can be overridden by .env)
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
  process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';

  // No FROM_DATE/UNTIL_DATE env; cron path defaults to previous day (JST)
  process.env.APP_ENV = process.env.APP_ENV || 'local';

  process.env.CHAR_THRESHOLD = process.env.CHAR_THRESHOLD || '10000';

  process.env.GEMINI_MAX_INPUT_TOKEN = '4096';

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY must be set in .env for local invoke');
  }
  console.log('Running local invoke...');

  const res = await handler(event as any, {} as any, () => {});~
  console.log(res);
})();
