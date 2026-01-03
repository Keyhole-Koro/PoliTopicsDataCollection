import { DISCORD_COLORS, type DiscordField, sendNotification } from "@keyhole-koro/politopics-notification";
import { appConfig } from "../config";
import type { IssueTask } from "@DynamoDB/tasks";
import type { RunRange } from "@utils/range";

type TaskCreationSummary = {
  range: RunRange;
  meetingsProcessed: number;
  createdCount: number;
  existingCount: number;
  issueIds: string[];
};

function baseFields(range?: RunRange): DiscordField[] {
  const fields: DiscordField[] = [{ name: "Environment", value: appConfig.environment, inline: true }];
  if (range) {
    fields.push({ name: "Range", value: `${range.from} → ${range.until}`, inline: true });
  }
  return fields;
}

function formatError(error: unknown): string {
  if (!error) return "Unknown error";
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`.slice(0, 900);
  }
  return String(error).slice(0, 900);
}

export async function notifyRunError(message: string, opts: { range?: RunRange; error?: unknown } = {}): Promise<void> {
  const fields = baseFields(opts.range);
  if (opts.error) {
    fields.push({ name: "Error", value: formatError(opts.error) });
  }

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.errorWebhook,
    title: message,
    content: ":rotating_light: DataCollection error",
    color: DISCORD_COLORS.error,
    fields,
    label: "data-collection-error",
  });
}

export async function notifyRunWarning(
  message: string,
  opts: { range?: RunRange; detail?: string } = {},
): Promise<void> {
  const fields = baseFields(opts.range);
  if (opts.detail) {
    fields.push({ name: "Detail", value: opts.detail.slice(0, 900) });
  }

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.warnWebhook,
    fallbackWebhook: appConfig.notifications.errorWebhook,
    title: message,
    content: ":warning: DataCollection warning",
    color: DISCORD_COLORS.warn,
    fields,
    label: "data-collection-warning",
  });
}

export async function notifyTasksCreated(summary: TaskCreationSummary): Promise<void> {
  if (summary.createdCount <= 0) return;
  const fields: DiscordField[] = [
    ...baseFields(summary.range),
    { name: "New tasks", value: String(summary.createdCount), inline: true },
    { name: "Meetings processed", value: String(summary.meetingsProcessed), inline: true },
    { name: "Existing tasks", value: String(summary.existingCount), inline: true },
  ];

  if (summary.issueIds.length > 0) {
    const preview = summary.issueIds.slice(0, 5).join(", ");
    const suffix = summary.issueIds.length > 5 ? " …" : "";
    fields.push({ name: "Issue IDs", value: `${preview}${suffix}` });
  }

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.batchWebhook,
    fallbackWebhook: appConfig.notifications.warnWebhook ?? appConfig.notifications.errorWebhook,
    title: "Task registration completed",
    content: `:white_check_mark: DataCollection registered ${summary.createdCount} tasks`,
    color: DISCORD_COLORS.batch,
    fields,
    label: "data-collection-batch",
  });
}

export async function notifyTaskWriteFailure(task: IssueTask, error: unknown): Promise<void> {
  const fields: DiscordField[] = [
    { name: "Task ID", value: task.pk, inline: true },
    { name: "LLM", value: `${task.llm}/${task.llmModel}`, inline: true },
    { name: "Mode", value: task.processingMode, inline: true },
    { name: "Meeting", value: task.meeting?.nameOfMeeting ?? "unknown" },
    { name: "Error", value: formatError(error) },
  ];

  await sendNotification({
    environment: appConfig.environment,
    webhook: appConfig.notifications.warnWebhook,
    fallbackWebhook: appConfig.notifications.errorWebhook,
    title: "DynamoDB write failed",
    content: ":warning: Failed to persist task",
    color: DISCORD_COLORS.warn,
    fields,
    label: "data-collection-task-write-failed",
  });
}
