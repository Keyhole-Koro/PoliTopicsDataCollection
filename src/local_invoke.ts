import 'dotenv/config';
import { handler } from './lambda_handler';
import type { ScheduledEvent } from 'aws-lambda';

(async () => {
  // Minimal ScheduledEvent-like object
  const event: ScheduledEvent = { source: 'aws.events' } as any;

  process.env.NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting?limit=1";

  // Local defaults (can be overridden by .env)
  process.env.AWS_REGION = process.env.AWS_REGION || 'ap-northeast-3';
  process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
  process.env.TABLE_NAME = process.env.TABLE_NAME || 'politopics';
  process.env.ERROR_BUCKET = process.env.ERROR_BUCKET || 'politopics-error-logs';

  // No FROM_DATE/UNTIL_DATE env; cron path defaults to previous day (JST)
  process.env.APP_ENV = process.env.APP_ENV || 'local';
  process.env.LLM_PROVIDER = process.env.LLM_PROVIDER || 'gemini';
  process.env.LLM_CACHE_ENABLED = process.env.LLM_CACHE_ENABLED || 'true';
  
  process.env.LLM_RPS = process.env.LLM_RPS || '0.15';
  process.env.LLM_BURST = process.env.LLM_BURST || '1';
  process.env.LLM_REDUCE_CONCURRENCY = process.env.LLM_REDUCE_CONCURRENCY || '1';
  process.env.LLM_CHUNK_CONCURRENCY = process.env.LLM_CHUNK_CONCURRENCY || '1';

  process.env.REDUCE_GROUP_SIZE = process.env.REDUCE_GROUP_SIZE || '3';
  process.env.REDUCE_CONCURRENCY = process.env.REDUCE_CONCURRENCY || '1';
  process.env.CHAR_THRESHOLD = process.env.CHAR_THRESHOLD || '10000';

  // Keep provider as gemini by default; do not override to groq



  // Please set your real API and key in .env for full run:
  // process.env.NATIONAL_DIET_API_ENDPOINT = "...";
  // process.env.GEMINI_API_KEY = "...";

  console.log('Running local invoke...');

  const res = await handler(event as any, {} as any, () => {});
  console.log(res);
})();
