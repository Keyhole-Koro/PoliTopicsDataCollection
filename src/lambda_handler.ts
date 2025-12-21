import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Handler, ScheduledEvent } from 'aws-lambda';

import { S3Client } from '@aws-sdk/client-s3';

import { GoogleGenerativeAI } from '@google/generative-ai';

import { chunk_prompt, reduce_prompt, single_chunk_prompt } from '@prompts/prompts';
import { getAwsS3ClientConfig } from '@utils/aws';
import { appConfig } from './config';

import { resJson, isApiResponse } from './lambda/httpResponses';
import { fetchMeetingsForRange } from './lambda/meetings';
import { resolveRunRange } from './lambda/rangeResolver';
import { buildTasksForMeeting } from './lambda/taskBuilder';
import { TaskRepository } from '@DynamoDB/tasks';

const PROMPT_BUCKET = appConfig.promptBucket;
const RUN_ID_PLACEHOLDER = '';
const s3 = new S3Client(getAwsS3ClientConfig());
const taskRepo = new TaskRepository();

const nationalDietApiEndpoint = appConfig.nationalDietApiEndpoint;

const geminiMaxInputToken: number = appConfig.gemini.maxInputToken;
const genAI = new GoogleGenerativeAI(appConfig.gemini.apiKey);
const model = genAI.getGenerativeModel({ model: appConfig.gemini.model });

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
    const singleChunkPromptTemplate = single_chunk_prompt('');
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
        singleChunkPromptTemplate,
        availableTokens,
        range,
        bucket: PROMPT_BUCKET,
        geminiModel: appConfig.gemini.model,
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
