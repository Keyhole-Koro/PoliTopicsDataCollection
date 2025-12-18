import {
  array,
  check,
  nullable,
  number,
  object,
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

const stringField = string();

export const rawSpeechRecordSchema = object({
  speechID: string(),
  speechOrder: numericField,
  speaker: stringField,
  speakerYomi: nullable(string()),
  speakerGroup: nullable(string()),
  speakerPosition: nullable(string()),
  speakerRole: nullable(string()),
  speech: stringField,
  startPage: numericField,
  createTime: stringField,
  updateTime: stringField,
  speechURL: stringField,
});

const speechRecordArraySchema = pipe(
  union([array(rawSpeechRecordSchema), rawSpeechRecordSchema]),
  transform((value) => (Array.isArray(value) ? value : [value])),
);

export type RawSpeechRecord = InferOutput<typeof rawSpeechRecordSchema>;

export const rawMeetingRecordSchema = object({
  issueID: stringField,
  imageKind: stringField,
  searchObject: numericField,
  session: numericField,
  nameOfHouse: stringField,
  nameOfMeeting: stringField,
  issue: stringField,
  date: stringField,
  closing: nullable(string()),
  speechRecord: speechRecordArraySchema,
});

const meetingRecordArraySchema = pipe(
  union([array(rawMeetingRecordSchema), rawMeetingRecordSchema]),
  transform((value) => (Array.isArray(value) ? value : [value])),
);

export type RawMeetingRecord = InferOutput<typeof rawMeetingRecordSchema>;

const nextRecordPositionField = nullable(numericField);

export const rawMeetingDataSchema = object({
  numberOfRecords: numericField,
  numberOfReturn: numericField,
  startRecord: numericField,
  nextRecordPosition: nextRecordPositionField,
  meetingRecord: meetingRecordArraySchema,
});

export type RawMeetingData = InferOutput<typeof rawMeetingDataSchema>;
