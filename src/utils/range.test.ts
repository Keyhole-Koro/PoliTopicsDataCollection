import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { defaultCronRange, deriveRangeFromHttp } from './range';
import { dateStrJST } from './date';

describe('range utils', () => {
  const TODAY = dateStrJST(0);
  const PAST_21 = dateStrJST(-21);

  describe('defaultCronRange', () => {
    it('should return a range from 21 days ago until today', () => {
      const range = defaultCronRange();
      expect(range.from).toBe(PAST_21);
      expect(range.until).toBe(TODAY);
    });
  });

  describe('deriveRangeFromHttp', () => {
    // Helper to create a partial mock event
    const createEvent = (
      method: 'GET' | 'POST',
      queryStringParameters?: Record<string, string>,
      body?: string
    ): APIGatewayProxyEventV2 => ({
      requestContext: {
        http: { method, path: '/', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
        accountId: '', apiId: '', domainName: '', domainPrefix: '', requestId: '', routeKey: '', stage: '', time: '', timeEpoch: 0
      },
      queryStringParameters,
      body,
      isBase64Encoded: false,
      headers: {},
      rawPath: '',
      rawQueryString: '',
      routeKey: '',
      version: ''
    });

    it('should use specified from/until in GET request', () => {
      const event = createEvent('GET', { from: '2025-01-01', until: '2025-01-05' });
      const range = deriveRangeFromHttp(event);
      expect(range).toEqual({ from: '2025-01-01', until: '2025-01-05' });
    });

    it('should default to today if params are missing in GET request', () => {
      const event = createEvent('GET', {});
      const range = deriveRangeFromHttp(event);
      expect(range).toEqual({ from: TODAY, until: TODAY });
    });

    it('should default "until" to "from" if only "from" is specified in GET request', () => {
      const event = createEvent('GET', { from: '2025-01-01' });
      const range = deriveRangeFromHttp(event);
      expect(range).toEqual({ from: '2025-01-01', until: '2025-01-01' });
    });

    it('should use specified from/until in POST request body', () => {
      const body = JSON.stringify({ from: '2025-02-01', until: '2025-02-10' });
      const event = createEvent('POST', undefined, body);
      const range = deriveRangeFromHttp(event);
      expect(range).toEqual({ from: '2025-02-01', until: '2025-02-10' });
    });

    it('should default to today if POST body is empty/missing properties', () => {
      const event = createEvent('POST', undefined, '{}');
      const range = deriveRangeFromHttp(event);
      expect(range).toEqual({ from: TODAY, until: TODAY });
    });
  });
});
