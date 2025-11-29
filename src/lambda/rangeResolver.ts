import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2, ScheduledEvent } from 'aws-lambda';

import { isHttpApiEvent, lowercaseHeaders } from '@utils/http';
import { defaultCronRange, deriveRangeFromHttp, type RunRange } from '@utils/range';

import { resJson } from './httpResponses';

export function resolveRunRange(
  event: APIGatewayProxyEventV2 | ScheduledEvent,
): RunRange | APIGatewayProxyStructuredResultV2 {
  if (isHttpApiEvent(event)) {
    console.log(`[HTTP ${event.requestContext.http.method} ${event.requestContext.http.path}]`);
    const headers = lowercaseHeaders(event.headers);
    const expectedKey = process.env.RUN_API_KEY;
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
      const fromDate = process.env.FROM_DATE;
      const untilDate = process.env.UNTIL_DATE;
      if (!fromDate || !untilDate) {
        throw new Error('FROM_DATE and UNTIL_DATE must be set for local events');
      }
      return { from: fromDate, until: untilDate };
    }
    default:
      return resJson(400, { error: 'invalid_range', message: 'Could not determine run range.' });
  }
}
