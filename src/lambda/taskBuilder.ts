import type { S3Client } from '@aws-sdk/client-s3';

import type { RawSpeechRecord } from '@NationalDietAPI/Raw';
import type { PromptTaskMessage } from '@SQS/sqs';
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
}): Promise<PromptTaskMessage[]> {
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
    return [];
  }

  const meetingName = meeting.nameOfMeeting?.trim() || 'Unknown meeting';
  const meetingHouse = meeting.nameOfHouse?.trim() || 'Unknown house';
  const meetingDate = meeting.date?.trim() || '';

  const speeches: RawSpeechRecord[] = meeting.speechRecord ?? [];

  if (!speeches.length) {
    console.log(`[Meeting ${meetingIssueID}] No speeches available; skipping.`);
    return [];
  }

  const orderLens: OrderLen[] = await buildOrderLenByTokens({ speeches, countFn: countTokens });
  const packs: IndexPack[] = packIndexSets(orderLens, availableTokens);

  if (!packs.length) {
    console.log(`[Meeting ${meetingIssueID}] Unable to create chunk packs within token budget; skipping.`);
    return [];
  }

  const tasks: PromptTaskMessage[] = [];
  const chunkResultUrls: string[] = [];

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

    chunkResultUrls.push(resultS3Url);

    tasks.push({
      type: 'map',
      url: s3Url,
      result_url: resultS3Url,
      llm: 'gemini',
      llmModel: geminiModel,
      meta: {
        speech_ids: pack.speech_ids,
        totalLen: pack.totalLen,
        indices: pack.indices,
        range,
        issueID: meetingIssueID,
        runId,
        startedAt: isoNow(),
      },
      retryAttempts: 0,
      retryMs_in: 0,
    });
  }

  tasks.push({
    type: 'reduce',
    chunk_result_urls: chunkResultUrls,
    prompt: reducePromptTemplate,
    issueID: meetingIssueID,
    meeting: {
      issueID: meetingIssueID,
      nameOfMeeting: meetingName,
      nameOfHouse: meetingHouse,
      date: meetingDate || new Date().toISOString().split('T')[0],
      numberOfSpeeches: speeches.length,
    },
    llm: 'gemini',
    llmModel: geminiModel,
    meta: {
      range,
      runId,
      startedAt: isoNow(),
    },
    retryAttempts: 0,
    retryMs_in: 0,
  });

  return tasks;
}
