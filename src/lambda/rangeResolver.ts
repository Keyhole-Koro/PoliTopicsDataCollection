import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, ScheduledEvent } from 'aws-lambda';

import { isHttpApiEvent, lowercaseHeaders } from '@utils/http';
import { defaultCronRange, deriveRangeFromHttp, type RunRange } from '@utils/range';

import { resJson } from './httpResponses';
import { appConfig } from '../config';

export function resolveRunRange(
  event: APIGatewayProxyEventV2 | ScheduledEvent,
): RunRange | APIGatewayProxyStructuredResultV2 {
  if (isHttpApiEvent(event)) {
    console.log(`[HTTP ${event.requestContext.http.method} ${event.requestContext.http.path}]`);
    const headers = lowercaseHeaders(event.headers);
    const expectedKey = appConfig.runApiKey;
    const providedKey = headers['x-api-key'];
    if (!expectedKey) {
      return resJson(500, { error: 'server_misconfigured', message: 'RUN_API_KEY is not set' });
    }
    if (providedKey !== expectedKey) {
      return resJson(401, { error: 'unauthorized' });
    }

    const range = deriveRangeFromHttp(event);
    if (!range) {
      return resJson(400, { error: 'invalid_json' });
    }
    if (range.from > range.until) {
      return resJson(400, { error: 'invalid_range', message: 'from must be <= until' });
    }
    return range;
  }

  switch ((event as ScheduledEvent).source) {
    case 'aws.events':
      return defaultCronRange();
    case 'local.events': {
      const range = appConfig.localRunRange;
      if (!range) {
        throw new Error('localRunRange must be set for local events');
      }
      return { from: range.from, until: range.until };
    }
    default:
      console.warn('[rangeResolver] Unrecognized event source; defaulting to cron range', {
        source: (event as ScheduledEvent).source,
      });
      return defaultCronRange();
  }
}
