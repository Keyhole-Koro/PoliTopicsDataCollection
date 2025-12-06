import type { RawSpeechRecord } from '@NationalDietAPI/Raw';
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
  geminiModel: string;
  runId: string;
  countTokens: CountFn;
}): Promise<IssueTask | undefined> {
  const {
    meeting,
    chunkPromptTemplate,
    reducePromptTemplate,
    availableTokens,
    range,
    geminiModel,
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
  };

  const singleChunkMode = packs.length === 1 && !packs[0]?.oversized;
  const createdAt = isoNow();

  if (singleChunkMode) {
    const pack = packs[0];
    const chunkSpeeches = collectSpeechesByIndex(speeches, pack.indices);
    const reducePromptPayload = {
      mode: 'direct' as const,
      chunkPromptTemplate,
      reducePromptTemplate,
      meeting: meetingInfo,
      range,
      packIndices: pack.indices,
      speechIds: pack.speech_ids,
      speeches: chunkSpeeches,
      runId,
    };
    const task: IssueTask = {
      pk: meetingIssueID,
      status: 'pending',
      llm: 'gemini',
      llmModel: geminiModel,
      retryAttempts: 0,
      createdAt,
      updatedAt: createdAt,
      processingMode: 'direct',
      prompt_payload: reducePromptPayload,
      meeting: meetingInfo,
      chunks: [],
    };
    return task;
  }

  const chunks: ChunkItem[] = [];

  let chunkCounter = 0;
  for (const pack of packs) {
    const chunkSpeeches = collectSpeechesByIndex(speeches, pack.indices);
    chunks.push({
      id: `CHUNK#${chunkCounter}`,
      payload: {
        prompt: chunkPromptTemplate,
        speeches: chunkSpeeches,
        speechIds: pack.speech_ids,
        indices: pack.indices,
      },
      status: 'notReady',
    });
    chunkCounter += 1;
  }

  if (!chunks.length) {
    console.warn(`[Meeting ${meetingIssueID}] Failed to create chunk prompts; skipping.`);
    return undefined;
  }

  const reducePromptPayload = {
    mode: 'chunked' as const,
    reducePromptTemplate,
    meeting: meetingInfo,
    range,
    chunkIds: chunks.map((chunk) => chunk.id),
    runId,
  };

  const task: IssueTask = {
    pk: meetingIssueID,
    status: 'pending',
    llm: 'gemini',
    llmModel: geminiModel,
    retryAttempts: 0,
    createdAt,
    updatedAt: createdAt,
    processingMode: 'chunked',
    prompt_payload: reducePromptPayload,
    meeting: meetingInfo,
    chunks,
  };

  return task;
}
