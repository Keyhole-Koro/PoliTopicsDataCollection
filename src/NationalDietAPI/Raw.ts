import {
  array,
  check,
  null_,
  number,
  nullable,
  object,
  optional,
  pipe,
  string,
  transform,
  toNumber,
  union,
  type InferOutput,
} from 'valibot';

const numericField = pipe(
  union([string(), number()]),
  toNumber(),
  check((value) => Number.isFinite(value), 'Expected a finite number'),
);

export const rawSpeechRecordSchema = object({
  speechID: string(),
  speechOrder: numericField,
  speaker: string(),
  speakerYomi: nullable(string()),
  speakerGroup: nullable(string()),
  speakerPosition: nullable(string()),
  speakerRole: nullable(string()),
  speech: string(),
  startPage: numericField,
  createTime: string(),
  updateTime: string(),
  speechURL: string(),
});

const speechRecordArraySchema = pipe(
  optional(union([array(rawSpeechRecordSchema), rawSpeechRecordSchema, null_()])),
  transform((value) => {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }),
);

export type RawSpeechRecord = InferOutput<typeof rawSpeechRecordSchema>;

export const rawMeetingRecordSchema = object({
  issueID: string(),
  imageKind: string(),
  searchObject: numericField,
  session: numericField,
  nameOfHouse: string(),
  nameOfMeeting: string(),
  issue: string(),
  date: string(),
  closing: nullable(string()),
  speechRecord: speechRecordArraySchema,
});

const meetingRecordArraySchema = pipe(
  optional(union([array(rawMeetingRecordSchema), rawMeetingRecordSchema, null_()])),
  transform((value) => {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }),
);

export type RawMeetingRecord = InferOutput<typeof rawMeetingRecordSchema>;

export const rawMeetingDataSchema = object({
  numberOfRecords: numericField,
  numberOfReturn: numericField,
  startRecord: numericField,
  nextRecordPosition: numericField,
  meetingRecord: meetingRecordArraySchema,
});

export type RawMeetingData = InferOutput<typeof rawMeetingDataSchema>;
