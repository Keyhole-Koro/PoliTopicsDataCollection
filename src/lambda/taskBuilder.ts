import type { S3Client } from '@aws-sdk/client-s3';

import type { RawSpeechRecord } from '@NationalDietAPI/Raw';
import { putJsonS3 } from '@S3/s3';
import type { RunRange } from '@utils/range';
import {
  buildOrderLenByTokens,
  packIndexSets,
  type CountFn,
  type IndexPack,
  type OrderLen,
} from '@utils/packing';

import type { MeetingRecord } from './meetings';
import type { ChunkItem, IssueTask } from '@DynamoDB/tasks';

const collectSpeechesByIndex = (speeches: RawSpeechRecord[], indices: number[]): RawSpeechRecord[] => (
  indices
    .map((idx) => speeches[idx])
    .filter((speech): speech is RawSpeechRecord => Boolean(speech))
);

const isoNow = (): string => new Date().toISOString();

export async function buildTasksForMeeting(args: {
  meeting: MeetingRecord;
  chunkPromptTemplate: string;
  reducePromptTemplate: string;
  availableTokens: number;
  range: RunRange;
  bucket: string;
  geminiModel: string;
  s3: S3Client;
  runId: string;
  countTokens: CountFn;
}): Promise<IssueTask | undefined> {
  const {
    meeting,
    chunkPromptTemplate,
    reducePromptTemplate,
    availableTokens,
    range,
    bucket,
    geminiModel,
    s3,
    runId,
    countTokens,
  } = args;

  const meetingIssueID = meeting.issueID?.trim();
  if (!meetingIssueID) {
    console.warn('[Meeting] Missing issueID; skipping meeting with payload:', {
      date: meeting.date,
      nameOfMeeting: meeting.nameOfMeeting,
    });
    return undefined;
  }

  const meetingName = meeting.nameOfMeeting?.trim() || 'Unknown meeting';
  const meetingHouse = meeting.nameOfHouse?.trim() || 'Unknown house';
  const meetingDate = meeting.date?.trim() || '';

  const speeches: RawSpeechRecord[] = meeting.speechRecord ?? [];
  if (!speeches.length) {
    console.log(`[Meeting ${meetingIssueID}] No speeches available; skipping.`);
    return undefined;
  }

  const orderLens: OrderLen[] = await buildOrderLenByTokens({ speeches, countFn: countTokens });
  const packs: IndexPack[] = packIndexSets(orderLens, availableTokens);

  if (!packs.length) {
    console.log(`[Meeting ${meetingIssueID}] Unable to create chunk packs within token budget; skipping.`);
    return undefined;
  }

  const meetingInfo = {
    issueID: meetingIssueID,
    nameOfMeeting: meetingName,
    nameOfHouse: meetingHouse,
    date: meetingDate || new Date().toISOString().split('T')[0],
    numberOfSpeeches: speeches.length,
    session: meeting.session ?? 0,
  };

  const reducePromptKeyBase = `prompts/reduce/${meetingIssueID}`;
  const singleChunkMode = packs.length === 1 && !packs[0]?.oversized;
  const createdAt = isoNow();

  if (singleChunkMode) {
    const pack = packs[0];
    const chunkSpeeches = collectSpeechesByIndex(speeches, pack.indices);
    const reducePromptKey = `${reducePromptKeyBase}_direct.json`;
    const reducePromptPayload = {
      mode: 'direct',
      chunkPromptTemplate,
      reducePromptTemplate,
      meeting: meetingInfo,
      range,
      packIndices: pack.indices,
      speechIds: pack.speech_ids,
      speeches: chunkSpeeches,
      runId,
    };
    await putJsonS3({
      s3,
      bucket,
      key: reducePromptKey,
      body: reducePromptPayload,
    });
    const task: IssueTask = {
      pk: meetingIssueID,
      status: 'pending',
      llm: 'gemini',
      llmModel: geminiModel,
      retryAttempts: 0,
      createdAt,
      updatedAt: createdAt,
      processingMode: 'direct',
      prompt_url: `s3://${bucket}/${reducePromptKey}`,
      meeting: meetingInfo,
      result_url: `s3://${bucket}/results/${meetingIssueID}_reduce.json`,
      chunks: [],
    };
    return task;
  }

  const chunks: ChunkItem[] = [];

  let chunkCounter = 0;
  for (const pack of packs) {
    const chunkSpeeches = collectSpeechesByIndex(speeches, pack.indices);
    const s3key = `prompts/${meetingIssueID}_${pack.indices.join('-')}.json`;
    const s3Url = `s3://${bucket}/${s3key}`;
    const resultS3Key = `results/${meetingIssueID}_${pack.indices.join('-')}_result.json`;
    const resultS3Url = `s3://${bucket}/${resultS3Key}`;

    try {
      await putJsonS3({
        s3,
        bucket,
        key: s3key,
        body: {
          prompt: chunkPromptTemplate,
          speeches: chunkSpeeches,
          speechIds: pack.speech_ids,
          indices: pack.indices,
        },
      });
    } catch (error) {
      console.error(`[Meeting ${meetingIssueID}] Failed to write prompt payload to S3:`, error);
      continue;
    }

    chunks.push({
      id: `CHUNK#${chunkCounter}`,
      prompt_key: s3key,
      prompt_url: s3Url,
      result_url: resultS3Url,
      status: 'notReady',
    });
    chunkCounter += 1;
  }

  if (!chunks.length) {
    console.warn(`[Meeting ${meetingIssueID}] Failed to create chunk prompts; skipping.`);
    return undefined;
  }

  const reducePromptKey = `${reducePromptKeyBase}.json`;
  await putJsonS3({
    s3,
    bucket,
    key: reducePromptKey,
    body: {
      mode: 'chunked',
      reducePromptTemplate,
      meeting: meetingInfo,
      range,
      chunks,
      chunkResultUrls: chunks.map((chunk) => chunk.result_url),
      runId,
    },
  });

  const task: IssueTask = {
    pk: meetingIssueID,
    status: 'pending',
    llm: 'gemini',
    llmModel: geminiModel,
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    processingMode: 'chunked',
    prompt_url: `s3://${bucket}/${reducePromptKey}`,
    meeting: meetingInfo,
    result_url: `s3://${bucket}/results/${meetingIssueID}_reduce.json`,
    chunks,
  };

  return task;
}
