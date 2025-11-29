import { ValiError } from 'valibot';

import fetchNationalDietRecords from './NationalDietAPI';

describe('fetchNationalDietRecords', () => {
  const originalFetch = global.fetch;
  const mockFetch = jest.fn();

  const mockFetchResponse = (payload: unknown, ok = true, statusText = 'OK') => {
    mockFetch.mockResolvedValue({
      ok,
      statusText,
      json: async () => payload,
    } as any);
  };

  beforeEach(() => {
    mockFetch.mockReset();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('parses valid payloads and normalizes array fields', async () => {
    mockFetchResponse({
      numberOfRecords: '1',
      numberOfReturn: '1',
      startRecord: 1,
      nextRecordPosition: '2',
      meetingRecord: {
        issueID: 'ISS-1',
        imageKind: 'text',
        searchObject: '10',
        session: '3',
        nameOfHouse: 'House',
        nameOfMeeting: 'Budget Committee',
        issue: 'Budget',
        date: '2024-01-01',
        closing: null,
        speechRecord: {
          speechID: 'sp-1',
          speechOrder: '5',
          speaker: 'Member A',
          speakerYomi: null,
          speakerGroup: null,
          speakerPosition: null,
          speakerRole: null,
          speech: 'Hello world',
          startPage: '1',
          createTime: '2024-01-01T00:00:00Z',
          updateTime: '2024-01-01T00:00:00Z',
          speechURL: 'https://example.com/speech',
        },
      },
    });

    const result = await fetchNationalDietRecords('https://example.com/api');

    expect(result.numberOfRecords).toBe(1);
    const meetings = result.meetingRecord ?? [];
    expect(meetings).toHaveLength(1);
    const [meeting] = meetings;
    if (!meeting) {
      throw new Error('Expected meeting to be defined');
    }
    const speeches = meeting.speechRecord ?? [];
    expect(speeches).toHaveLength(1);
    expect(speeches[0]?.speechOrder).toBe(5);
  });

  test('throws when payload does not satisfy schema', async () => {
    mockFetchResponse({
      numberOfRecords: 1,
      numberOfReturn: 1,
      startRecord: 1,
      nextRecordPosition: 0,
      meetingRecord: [
        {
          issueID: 'ISS-1',
          imageKind: 'text',
          searchObject: 0,
          session: 1,
          nameOfHouse: 'House',
          nameOfMeeting: 'Budget Committee',
          issue: 'Budget',
          date: '2024-01-01',
          closing: null,
          speechRecord: [
            {
              speechID: 'sp-1',
              speechOrder: 'NaN',
              speaker: 'Member A',
              speakerYomi: null,
              speakerGroup: null,
              speakerPosition: null,
              speakerRole: null,
              speech: 'Hello world',
              startPage: 1,
              createTime: '2024-01-01T00:00:00Z',
              updateTime: '2024-01-01T00:00:00Z',
              speechURL: 'https://example.com/speech',
            },
          ],
        },
      ],
    });

    await expect(fetchNationalDietRecords('https://example.com/api')).rejects.toThrow(ValiError);
  });
});
