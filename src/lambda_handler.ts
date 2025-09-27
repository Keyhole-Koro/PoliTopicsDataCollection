import 'dotenv/config';

import { Handler, ScheduledEvent } from 'aws-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

import { S3Client } from "@aws-sdk/client-s3";

import { GoogleGenerativeAI } from "@google/generative-ai";

import fetchNationalDietRecords from '@NationalDietAPI/NationalDietAPI';
import type { RawMeetingData, RawSpeechRecord } from '@NationalDietAPI/Raw';
import { enqueuePromptsWithS3Batch, type PromptTaskMessage } from '@SQS/sqs';
import { putJsonS3, writeRunLog } from '@S3/s3';

import { prompt } from '@prompts/prompts';
import { getAwsRegion } from '@utils/aws';

import { isHttpApiEvent, lowercaseHeaders } from '@utils/http';
import { defaultCronRange, deriveRangeFromHttp, deriveRangeFromSqsRecord, type RunRange } from '@utils/range';
import { buildOrderLenByTokens, IndexPack, packIndexSets, type OrderLen } from '@utils/packing';

if (!process.env.GEMINI_MAX_INPUT_TOKEN) {
  throw new Error("GEMINI_MAX_INPUT_TOKEN is not set");
}
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is not set");
}

const prompt_bucket = "politopics-prompts";

// AWS SDK setup (supports LocalStack via AWS_ENDPOINT_URL)
const endpoint = process.env.AWS_ENDPOINT_URL;
const s3 = new S3Client({ region: getAwsRegion(), ...(endpoint ? { endpoint } : {}) });

// National Diet API endpoint
const national_diet_api_endpoint = process.env.NATIONAL_DIET_API_ENDPOINT || "https://kokkai.ndl.go.jp/api/meeting";

const GEMINI_MAX_INPUT_TOKEN: number = Number(process.env.GEMINI_MAX_INPUT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });

async function countTokens(text: string): Promise<number> {
  const response = await model.countTokens({ contents: [{ role: "user", parts: [{ text }] }] });
  return response.totalTokens;
}

const resJson = (statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});


const composeSpeechesFromIndices = (speeches: RawSpeechRecord[], indices: number[]): RawSpeechRecord[] => {
  return indices
    .map((idx) => speeches[idx])
    .filter((speech): speech is RawSpeechRecord => Boolean(speech));
}

export const handler: Handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent) => {
  var rr: RunRange | null;

  // extract run range from event
  if (isHttpApiEvent(event)) {
    console.log(`[HTTP ${event.requestContext.http.method} ${event.requestContext.http.path}`);
    const headers = lowercaseHeaders(event.headers);
    const expectedKey = process.env.RUN_API_KEY;
    const providedKey = headers['x-api-key'];
    if (!expectedKey) return resJson(500, { error: 'server_misconfigured', message: 'RUN_API_KEY is not set' });
    if (providedKey !== expectedKey) return resJson(401, { error: 'unauthorized' });

    // invoked by user on-demand
    rr = deriveRangeFromHttp(event);
    if (!rr) return resJson(400, { error: 'invalid_json' });
    if (rr.from > rr.until) return resJson(400, { error: 'from must be <= until' });
  } else if (event.source === 'aws.events') {
    rr = defaultCronRange(); // yesterday
  } else if (event.source === 'local.events') {
    const fromDate = process.env.FROM_DATE;
    const untilDate = process.env.UNTIL_DATE;
    
    if (!fromDate || !untilDate) {
      throw new Error("FROM_DATE and UNTIL_DATE must be set for local events");
    }
    
    rr = {
      from: fromDate,
      until: untilDate
    };
  } else {
    return resJson(400, { error: 'invalid_range', message: 'Could not determine run range.' });
  }

  try {
    const rawMeetingData: RawMeetingData = await fetchNationalDietRecords(
      national_diet_api_endpoint,
      {
        from: rr.from,
        until: rr.until
      }
    );

    if (rawMeetingData.numberOfRecords && rawMeetingData.numberOfRecords == 0) {
      console.log(`No meetings found for range ${rr.from} to ${rr.until}`);
      return resJson(200, { message: 'No meetings found for the specified range.' });
    }

    for (const meeting of rawMeetingData.meetingRecord) {
      const issueID = meeting.issueID;
      const speeches = meeting.speechRecord ?? [];

      const orderLens: OrderLen[] = await buildOrderLenByTokens({
        speeches,
        countFn: countTokens,
      });

      const promptTemplate = prompt();
      const availableTokens = GEMINI_MAX_INPUT_TOKEN - (await countTokens(promptTemplate));
      const packed: IndexPack[] = packIndexSets(orderLens, availableTokens);

      const items: PromptTaskMessage[] = [];
      var s3urls: string[] = [];

      for (const p of packed) {
        const chunkSpeeches = composeSpeechesFromIndices(speeches, p.indices);
        const s3key = `prompts/${issueID}_${p.indices.join('-')}.json`;

        try {
          await putJsonS3({
            s3,
            bucket: prompt_bucket,
            key: s3key,
            body: {
              prompt: promptTemplate,
              speeches: chunkSpeeches,
              speechIds: p.speech_ids,
              indices: p.indices,
            },
          });
        } catch (error) {
          console.error('Failed to write prompt payload to S3:', error);
          continue;
        }

        s3urls.push(`s3://${prompt_bucket}/${s3key}`);

        items.push({
          type: 'chunk',
          url: `s3://${prompt_bucket}/${s3key}`,
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: {
            speech_ids: p.speech_ids,
            totalLen: p.totalLen,
            indices: p.indices,
            range: rr,
            runId: '', // to be filled later
            startedAt: new Date().toISOString(),
          },
        });
      }

      if (s3urls.length) {
        items.push({
          type: 'reduce',
          urls: s3urls,
          llm: 'gemini',
          llmModel: 'gemini-2.5-pro',
          meta: {
            issueID,
            numChunks: packed.length,
            range: rr,
            runId: '', // to be filled later
            startedAt: new Date().toISOString(),
          },
        });
      }

      if (items.length) {
        await enqueuePromptsWithS3Batch({
          items,
          queueUrl: process.env.PROMPT_QUEUE_URL,
        });
      }
    }

    //const payload = await preparePromptsForRange(rr.from, rr.until, 'apigw', runId, startedAt);
    return resJson(200, { message: 'Event processed (on-demand).' });
  } catch (e) {
    console.error('Error processing event:', e);
    return resJson(500, { error: 'internal_error', message: (e as Error).message || e });
  }
}
