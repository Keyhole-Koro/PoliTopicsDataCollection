import 'dotenv/config';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Handler, ScheduledEvent } from 'aws-lambda';

import { S3Client } from '@aws-sdk/client-s3';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { enqueuePromptsWithS3Batch } from '@SQS/sqs';

import { chunk_prompt, reduce_prompt } from '@prompts/prompts';
import { getAwsEndpoint, getAwsRegion } from '@utils/aws';

import { resJson, isApiResponse } from './lambda/httpResponses';
import { fetchMeetingsForRange } from './lambda/meetings';
import { resolveRunRange } from './lambda/rangeResolver';
import { buildTasksForMeeting } from './lambda/taskBuilder';

if (!process.env.GEMINI_MAX_INPUT_TOKEN) {
  throw new Error('GEMINI_MAX_INPUT_TOKEN is not set');
}
if (!process.env.GEMINI_API_KEY) {
  throw new Error('GEMINI_API_KEY is not set');
}

const GEMINI_MODEL = 'gemini-2.5-pro';
const PROMPT_BUCKET = 'politopics-prompts';
const RUN_ID_PLACEHOLDER = '';

const awsRegion = getAwsRegion();
const awsEndpoint = getAwsEndpoint();
const s3 = new S3Client({
  region: awsRegion,
  ...(awsEndpoint ? { endpoint: awsEndpoint, forcePathStyle: true } : {}),
});

const nationalDietApiEndpoint = process.env.NATIONAL_DIET_API_ENDPOINT || 'https://kokkai.ndl.go.jp/api/meeting';

const geminiMaxInputToken: number = Number(process.env.GEMINI_MAX_INPUT_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

async function countTokens(text: string): Promise<number> {
  const response = await model.countTokens({ contents: [{ role: 'user', parts: [{ text }] }] });
  return response.totalTokens;
}

export const handler: Handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent) => {
  const rangeOrResponse = resolveRunRange(event);
  if (isApiResponse(rangeOrResponse)) {
    return rangeOrResponse;
  }

  const range = rangeOrResponse;

  try {
    const { meetings, recordCount } = await fetchMeetingsForRange(nationalDietApiEndpoint, range);

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
        bucket: PROMPT_BUCKET,
        geminiModel: GEMINI_MODEL,
        s3,
        runId: RUN_ID_PLACEHOLDER,
        countTokens,
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
