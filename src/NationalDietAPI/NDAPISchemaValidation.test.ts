import { ValiError } from 'valibot';

import { parseNationalDietResponse } from './NationalDietAPI';

describe('parseNationalDietResponse', () => {
  test('parses valid payloads and normalizes array fields', () => {
    const mockData = {
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
        closing: 'Adjourned',
        speechRecord: {
          speechID: 'sp-1',
          speechOrder: '5',
          speaker: 'Member A',
          speakerYomi: 'Member A Yomi',
          speakerGroup: 'Group A',
          speakerPosition: 'Member',
          speakerRole: 'Role A',
          speech: 'Hello world',
          startPage: '1',
          createTime: '2024-01-01T00:00:00Z',
          updateTime: '2024-01-01T00:00:00Z',
          speechURL: 'https://example.com/speech',
        },
      },
    };

    const result = parseNationalDietResponse(mockData);

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
    expect(speeches[0]?.createTime).toBe('2024-01-01');
    expect(speeches[0]?.updateTime).toBe('2024-01-01');
  });

  test('handles empty responses without meetingRecord data', () => {
    const mockData = {
      numberOfRecords: 0,
      numberOfReturn: 0,
      startRecord: 1,
      nextRecordPosition: null,
    };

    const result = parseNationalDietResponse(mockData);
    expect(result.numberOfRecords).toBe(0);
    expect(result.meetingRecord).toEqual([]);
    expect(result.nextRecordPosition).toBeNull();
  });

  test('throws when payload does not satisfy schema', () => {
    const mockData = {
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
        closing: 'Adjourned',
        speechRecord: [
          {
            speechID: 'sp-1',
            speechOrder: 'NaN',
            speaker: 'Member A',
            speakerYomi: 'Member A Yomi',
            speakerGroup: 'Group A',
            speakerPosition: 'Member',
            speakerRole: 'Role A',
            speech: 'Hello world',
              startPage: 1,
              createTime: '2024-01-01T00:00:00Z',
              updateTime: '2024-01-01T00:00:00Z',
              speechURL: 'https://example.com/speech',
            },
          ],
        },
      ],
    };

    expect(() => parseNationalDietResponse(mockData)).toThrow(ValiError);
  });
  test('normalizes timestamp strings to YYYY-MM-DD', () => {
    const mockData = {
      numberOfRecords: 1,
      numberOfReturn: 1,
      startRecord: 1,
      nextRecordPosition: 2,
      meetingRecord: {
        issueID: 'ISS-1',
        imageKind: 'text',
        searchObject: 1,
        session: 1,
        nameOfHouse: 'House',
        nameOfMeeting: 'Budget Committee',
        issue: 'Budget',
        date: '2024-01-01',
        closing: 'Adjourned',
        speechRecord: [
          {
            speechID: 'sp-1',
            speechOrder: 1,
            speaker: 'Member A',
            speakerYomi: null,
            speakerGroup: null,
            speakerPosition: null,
            speakerRole: null,
            speech: 'Hello',
            startPage: 1,
            createTime: '2025-11-18 23:04:25',
            updateTime: '2025-11-19 09:41:33',
            speechURL: 'https://example.com/speech',
          },
        ],
      },
    };

    const result = parseNationalDietResponse(mockData);

    const meeting = result.meetingRecord?.[0];
    expect(meeting?.speechRecord?.[0]?.createTime).toBe('2025-11-18');
    expect(meeting?.speechRecord?.[0]?.updateTime).toBe('2025-11-19');
  });
});
