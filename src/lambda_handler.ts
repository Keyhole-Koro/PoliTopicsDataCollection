import 'dotenv/config';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Handler, ScheduledEvent } from 'aws-lambda';

import { S3Client } from '@aws-sdk/client-s3';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { chunk_prompt, reduce_prompt } from '@prompts/prompts';
import { getAwsEndpoint, getAwsRegion } from '@utils/aws';

import { resJson, isApiResponse } from './lambda/httpResponses';
import { fetchMeetingsForRange } from './lambda/meetings';
import { resolveRunRange } from './lambda/rangeResolver';
import { buildTasksForMeeting } from './lambda/taskBuilder';
import { TaskRepository } from '@DynamoDB/tasks';

const requiredEnv = ['GEMINI_MAX_INPUT_TOKEN', 'GEMINI_API_KEY', 'PROMPT_BUCKET', 'NATIONAL_DIET_API_ENDPOINT'] as const;
type RequiredEnv = typeof requiredEnv[number];

const env: Record<RequiredEnv, string> = {} as Record<RequiredEnv, string>;
for (const key of requiredEnv) {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set`);
  }
  env[key] = value;
}

const GEMINI_MODEL = 'gemini-2.5-pro';
const PROMPT_BUCKET = env.PROMPT_BUCKET;
const RUN_ID_PLACEHOLDER = '';

const awsRegion = getAwsRegion();
const awsEndpoint = getAwsEndpoint();
const s3 = new S3Client({
  region: awsRegion,
  ...(awsEndpoint ? { endpoint: awsEndpoint, forcePathStyle: true } : {}),
});
const taskRepo = new TaskRepository();

const nationalDietApiEndpoint = env.NATIONAL_DIET_API_ENDPOINT;

const geminiMaxInputToken: number = Number(env.GEMINI_MAX_INPUT_TOKEN);
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
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
      const meetingIssueID = meeting.issueID?.trim();
      if (!meetingIssueID) {
        console.warn('[Meeting] Missing issueID; skipping meeting with payload:', {
          date: meeting.date,
          nameOfMeeting: meeting.nameOfMeeting,
        });
        continue;
      }

      const existingTask = await taskRepo.getTask(meetingIssueID);
      if (existingTask) {
        console.log(`[Meeting ${meetingIssueID}] Task already exists in DynamoDB; skipping creation.`);
        continue;
      }

      const issueTask = await buildTasksForMeeting({
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

      if (!issueTask) {
        continue;
      }

      try {
        await taskRepo.createTask(issueTask);
      } catch (error: any) {
        if (error?.name === 'ConditionalCheckFailedException') {
          console.log(`[Meeting ${meeting.issueID}] Task already exists; skipping creation.`);
        } else {
          throw error;
        }
      }
    }

    return resJson(200, { message: 'Event processed.' });
  } catch (error) {
    console.error('Error processing event:', error);
    return resJson(500, { error: 'internal_error', message: (error as Error).message || error });
  }
};
