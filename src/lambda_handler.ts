import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Handler, ScheduledEvent } from 'aws-lambda';

import { createHash } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';

import type { RawSpeechRecord } from '@NationalDietAPI/Raw';
import { putJsonS3 } from '@S3/s3';

import { appConfig } from './config';

import { resJson, isApiResponse } from './lambda/httpResponses';
import { fetchMeetingsForRange } from './lambda/meetings';
import { resolveRunRange } from './lambda/rangeResolver';
import { TaskRepository, type AttachedAssets, type IssueTask } from '@DynamoDB/tasks';
import {
  notifyRunError,
  notifyTaskWriteFailure,
  notifyTasksCreated,
} from './lambda/notifications';

const RAW_BUCKET = appConfig.promptBucket;
const s3 = new S3Client(appConfig.aws);
const taskRepo = new TaskRepository();

const nationalDietApiEndpoint = appConfig.nationalDietApiEndpoint;

type RawMeetingPayload = {
  meeting: Record<string, unknown>;
  ingestedAt: string;
  source: 'kokkai.ndl';
};

export const handler: Handler = async (event: APIGatewayProxyEventV2 | ScheduledEvent) => {
  const rangeOrResponse = resolveRunRange(event);
  if (isApiResponse(rangeOrResponse)) {
    return rangeOrResponse;
  }

  const range = rangeOrResponse;
  console.log(`[DataCollection] Starting run for range: ${JSON.stringify(range)}`);

  const summary = {
    range,
    meetingsProcessed: 0,
    createdCount: 0,
    existingCount: 0,
    issueIds: [] as string[],
  };

  try {
    const { meetings, recordCount } = await fetchMeetingsForRange(nationalDietApiEndpoint, range);
    console.log(`[DataCollection] Fetched ${meetings.length} meetings (total records: ${recordCount})`);

    if (!recordCount || !meetings.length) {
      console.log(`No meetings found for range ${range.from} to ${range.until}`);
      return resJson(200, { message: 'No meetings found for the specified range.' });
    }

    summary.meetingsProcessed = meetings.length;

    for (const meeting of meetings) {
      const meetingIssueID = meeting.issueID?.trim();
      console.log(`[DataCollection] Processing meeting: ${meetingIssueID} - ${meeting.nameOfMeeting}`);
      
      if (!meetingIssueID) {
        console.warn('[Meeting] Missing issueID; skipping meeting with payload:', {
          date: meeting.date,
          nameOfMeeting: meeting.nameOfMeeting,
        });
        continue;
      }

      if (!meeting.speechRecord?.length) {
        console.log(`[Meeting ${meetingIssueID}] No speeches available; skipping.`);
        continue;
      }

      const existingTask = await taskRepo.getTask(meetingIssueID);
      if (existingTask) {
        console.log(`[Meeting ${meetingIssueID}] Task already exists in DynamoDB; skipping creation.`);
        summary.existingCount += 1;
        continue;
      }

      const createdAt = isoTimestamp();
      const updatedAt = createdAt;
      const meetingInfo = {
        issueID: meetingIssueID,
        nameOfMeeting: meeting.nameOfMeeting.trim(),
        nameOfHouse: meeting.nameOfHouse.trim(),
        date: meeting.date.trim(),
        numberOfSpeeches: meeting.speechRecord.length,
        session: meeting.session,
      };

      const rawPayload = buildRawPayload(meeting, createdAt);
      const rawKey = `raw/${meetingIssueID}.json`;
      await putJsonS3({ s3, bucket: RAW_BUCKET, key: rawKey, body: rawPayload });
      const rawHash = hashPayload(rawPayload);

      const attachedAssets = await writeAttachedAssets({
        s3,
        bucket: RAW_BUCKET,
        issueID: meetingIssueID,
        speeches: meeting.speechRecord,
        createdAt,
      });

      const issueTask: IssueTask = {
        pk: meetingIssueID,
        status: 'ingested',
        retryAttempts: 0,
        createdAt,
        updatedAt,
        raw_url: `s3://${RAW_BUCKET}/${rawKey}`,
        raw_hash: rawHash,
        meeting: meetingInfo,
        attachedAssets,
      };

      try {
        await taskRepo.createTask(issueTask);
        console.log(`[DataCollection] Ingested raw payload for ${meetingIssueID}`);
        summary.createdCount += 1;
        summary.issueIds.push(meetingIssueID);
      } catch (error: any) {
        if (error?.name === 'ConditionalCheckFailedException') {
          console.log(`[Meeting ${meeting.issueID}] Task already exists; skipping creation.`);
          summary.existingCount += 1;
        } else {
          await notifyTaskWriteFailure(issueTask, error);
          throw error;
        }
      }
    }

    if (summary.createdCount > 0) {
      await notifyTasksCreated(summary);
    }

    return resJson(200, { message: 'Event processed.' });
  } catch (error) {
    console.error('Error processing event:', error);
    await notifyRunError('Unhandled DataCollection error', { range, error });
    return resJson(500, { error: 'internal_error', message: (error as Error).message || error });
  }
};

type SpeakerAttachment = {
  order: number;
  speechId?: string;
  speaker?: string;
  speakerYomi?: string | null;
  speakerGroup?: string | null;
  speakerPosition?: string | null;
  originalText?: string;
};

type AttachedAssetsPayload = {
  issueID: string;
  generatedAt: string;
  speeches: SpeakerAttachment[];
};

function isoTimestamp(): string {
  return new Date().toISOString();
}

function hashPayload(payload: RawMeetingPayload): string {
  const raw = JSON.stringify(payload);
  return createHash('sha256').update(raw).digest('hex');
}

function buildRawPayload(meeting: Record<string, unknown>, createdAt: string): RawMeetingPayload {
  return {
    meeting,
    ingestedAt: createdAt,
    source: 'kokkai.ndl',
  };
}

function buildSpeakerAttachments(speeches: RawSpeechRecord[]): SpeakerAttachment[] {
  return speeches
    .map((speech): SpeakerAttachment | null => {
      const order = Number(speech.speechOrder);
      if (!Number.isFinite(order)) return null;
      const originalText = typeof speech.speech === 'string' ? speech.speech.trim() : '';
      const speaker = typeof speech.speaker === 'string' ? speech.speaker.trim() : '';

      return {
        order,
        speechId: typeof speech.speechID === 'string' ? speech.speechID : undefined,
        speaker: speaker || undefined,
        speakerYomi: 'speakerYomi' in speech ? speech.speakerYomi ?? null : undefined,
        speakerGroup: 'speakerGroup' in speech ? speech.speakerGroup ?? null : undefined,
        speakerPosition: 'speakerPosition' in speech ? speech.speakerPosition ?? null : undefined,
        originalText: originalText || undefined,
      };
    })
    .filter((meta): meta is SpeakerAttachment => Boolean(meta));
}

async function writeAttachedAssets(args: {
  s3: S3Client;
  bucket: string;
  issueID: string;
  speeches: RawSpeechRecord[];
  createdAt: string;
}): Promise<AttachedAssets> {
  const { s3, bucket, issueID, speeches, createdAt } = args;
  const payload: AttachedAssetsPayload = {
    issueID,
    generatedAt: createdAt,
    speeches: buildSpeakerAttachments(speeches),
  };

  const key = `attachedAssets/${issueID}.json`;
  try {
    await putJsonS3({
      s3,
      bucket,
      key,
      body: payload,
    });
    return { speakerMetadataUrl: `s3://${bucket}/${key}` };
  } catch (error) {
    console.error(`[Meeting ${issueID}] Failed to write attached assets to S3`, { error });
    throw error;
  }
}
