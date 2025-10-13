import 'dotenv/config';

import { Handler, ScheduledEvent } from 'aws-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { S3Client } from '@aws-sdk/client-s3';

import { GoogleGenerativeAI } from '@google/generative-ai';

import fetchNationalDietRecords from '@NationalDietAPI/NationalDietAPI';
import type { RawMeetingData, RawSpeechRecord } from '@NationalDietAPI/Raw';
import { enqueuePromptsWithS3Batch, type PromptTaskMessage } from '@SQS/sqs';
import { putJsonS3 } from '@S3/s3';

import { chunk_prompt, reduce_prompt } from '@prompts/prompts';
import { getAwsRegion } from '@utils/aws';

import { isHttpApiEvent, lowercaseHeaders } from '@utils/http';
import { defaultCronRange, deriveRangeFromHttp, type RunRange } from '@utils/range';
import { buildOrderLenByTokens, packIndexSets, type OrderLen, type IndexPack } from '@utils/packing';

if (!process.env.GEMINI_MAX_INPUT_TOKEN) {
  throw new Error('GEMINI_MAX_INPUT_TOKEN is not set');
}
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set');
}

const GEMINI_MODEL = 'gemini-2.5-pro';
const PROMPT_BUCKET = 'politopics-prompts';
const RUN_ID_PLACEHOLDER = '';

const endpoint = process.env.AWS_ENDPOINT_URL;
const s3 = new S3Client({ region: getAwsRegion(), ...(endpoint ? { endpoint } : {}) });

const nationalDietApiEndpoint = process.env.NATIONAL_DIET_API_ENDPOINT || 'https://kokkai.ndl.go.jp/api/meeting';

const geminiMaxInputToken: number = Number(process.env.GEMINI_MAX_INPUT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

const resJson = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

type MeetingRecord = NonNullable<RawMeetingData['meetingRecord']>[number];

async function countTokens(text: string): Promise<number> {
  const response = await model.countTokens({ contents: [{ role: 'user', parts: [{ text }] }] });
  return response.totalTokens;
}

const collectSpeechesByIndex = (speeches: RawSpeechRecord[], indices: number[]): RawSpeechRecord[] => (
  indices
    .map((idx) => speeches[idx])
    .filter((speech): speech is RawSpeechRecord => Boolean(speech))
);

const isoNow = (): string => new Date().toISOString();

const isApiResponse = (value: unknown): value is APIGatewayProxyStructuredResultV2 => (
  typeof value === 'object' && value !== null && 'statusCode' in value
);

function resolveRunRange(event: APIGatewayProxyEventV2 | ScheduledEvent): RunRange | APIGatewayProxyStructuredResultV2 {
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

async function fetchMeetingsForRange(range: RunRange): Promise<{ meetings: MeetingRecord[]; recordCount: number }> {
  const rawMeetingData: RawMeetingData = await fetchNationalDietRecords(
    nationalDietApiEndpoint,
    { from: range.from, until: range.until },
  );

  const meetings = rawMeetingData.meetingRecord ?? [];
  const recordCountCandidate = typeof rawMeetingData.numberOfRecords === 'number'
    ? rawMeetingData.numberOfRecords
    : Number(rawMeetingData.numberOfRecords ?? meetings.length);
  const recordCount = Number.isFinite(recordCountCandidate) ? recordCountCandidate : meetings.length;

  return { meetings, recordCount };
}

async function buildTasksForMeeting(args: {
  meeting: MeetingRecord;
  chunkPromptTemplate: string;
  reducePromptTemplate: string;
  availableTokens: number;
  range: RunRange;
}): Promise<PromptTaskMessage[]> {
  const { meeting, chunkPromptTemplate, reducePromptTemplate, availableTokens, range } = args;
  const speeches: RawSpeechRecord[] = meeting.speechRecord ?? [];

  if (!speeches.length) {
    console.log(`[Meeting ${meeting.issueID}] No speeches available; skipping.`);
    return [];
  }

  const orderLens: OrderLen[] = await buildOrderLenByTokens({ speeches, countFn: countTokens });
  const packs: IndexPack[] = packIndexSets(orderLens, availableTokens);

  if (!packs.length) {
    console.log(`[Meeting ${meeting.issueID}] Unable to create chunk packs within token budget; skipping.`);
    return [];
  }

  const tasks: PromptTaskMessage[] = [];
  const chunkResultUrls: string[] = [];

  for (const pack of packs) {
    const chunkSpeeches = collectSpeechesByIndex(speeches, pack.indices);
    const s3key = `prompts/${meeting.issueID}_${pack.indices.join('-')}.json`;
    const s3Url = `s3://${PROMPT_BUCKET}/${s3key}`;
    const resultS3Key = `results/${meeting.issueID}_${pack.indices.join('-')}_result.json`;
    const resultS3Url = `s3://${PROMPT_BUCKET}/${resultS3Key}`;

    try {
      await putJsonS3({
        s3,
        bucket: PROMPT_BUCKET,
        key: s3key,
        body: {
          prompt: chunkPromptTemplate,
          speeches: chunkSpeeches,
          speechIds: pack.speech_ids,
          indices: pack.indices,
        },
      });
    } catch (error) {
      console.error(`[Meeting ${meeting.issueID}] Failed to write prompt payload to S3:`, error);
      continue;
    }

    chunkResultUrls.push(resultS3Url);

    tasks.push({
      type: 'map',
      url: s3Url,
      result_url: resultS3Url,
      llm: 'gemini',
      llmModel: GEMINI_MODEL,
      meta: {
        speech_ids: pack.speech_ids,
        totalLen: pack.totalLen,
        indices: pack.indices,
        range,
        issueID: meeting.issueID,
        runId: RUN_ID_PLACEHOLDER,
        startedAt: isoNow(),
      },
      retryAttempts: 0,
    });
  }

  tasks.push({
    type: 'reduce',
    chunk_result_urls: chunkResultUrls,
    prompt: reducePromptTemplate,
    issueID: meeting.issueID,
    meeting: {
      issueID: meeting.issueID,
      nameOfMeeting: meeting.nameOfMeeting,
      nameOfHouse: meeting.nameOfHouse,
      date: meeting.date,
      numberOfSpeeches: speeches.length,
    },
    llm: 'gemini',
    llmModel: GEMINI_MODEL,
    meta: {
      range,
      runId: RUN_ID_PLACEHOLDER,
      startedAt: isoNow(),
    },
    retryAttempts: 0,
  });

  return tasks;
}

export const handler: Handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent) => {
  const rangeOrResponse = resolveRunRange(event);
  if (isApiResponse(rangeOrResponse)) {
    return rangeOrResponse;
  }

  const range = rangeOrResponse;

  try {
    const { meetings, recordCount } = await fetchMeetingsForRange(range);

    if (!recordCount || !meetings.length) {
      console.log(`No meetings found for range ${range.from} to ${range.until}`);
      return resJson(200, { message: 'No meetings found for the specified range.' });
    }

    const chunkPromptTemplate = chunk_prompt('');
    const reducePromptTemplate = reduce_prompt('');
    const promptTokenCost = await countTokens(chunkPromptTemplate);
    const availableTokens = geminiMaxInputToken - promptTokenCost;

    if (availableTokens <= 0) {
      console.error('Chunk prompt exceeds available token budget; aborting run.');
      return resJson(500, { error: 'prompt_over_budget' });
    }

    for (const meeting of meetings) {
      const tasks = await buildTasksForMeeting({
        meeting,
        chunkPromptTemplate,
        reducePromptTemplate,
        availableTokens,
        range,
      });

      if (!tasks.length) {
        continue;
      }

      await enqueuePromptsWithS3Batch({
        items: tasks,
        queueUrl: process.env.PROMPT_QUEUE_URL,
      });
    }

    return resJson(200, { message: 'Event processed.' });
  } catch (error) {
    console.error('Error processing event:', error);
    return resJson(500, { error: 'internal_error', message: (error as Error).message || error });
  }
};
