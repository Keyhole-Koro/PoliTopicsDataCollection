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

const stringField = pipe(
  optional(union([string(), null_()])),
  transform((value) => value ?? ''),
);

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
  union([array(rawMeetingRecordSchema), rawMeetingRecordSchema, null_()]),
  transform((value) => {
    if (!value) {
      return [];
    }
    return Array.isArray(value) ? value : [value];
  }),
);

const meetingRecordFieldSchema = pipe(
  optional(meetingRecordArraySchema),
  transform((value) => value ?? []),
);

export type RawMeetingRecord = InferOutput<typeof rawMeetingRecordSchema>;

export const rawMeetingDataSchema = object({
  numberOfRecords: numericField,
  numberOfReturn: numericField,
  startRecord: numericField,
  nextRecordPosition: nullable(numericField),
  meetingRecord: meetingRecordFieldSchema,
});

export type RawMeetingData = InferOutput<typeof rawMeetingDataSchema>;
