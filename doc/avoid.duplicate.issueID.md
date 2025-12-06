# Avoid Duplicate issueID Inserts

Since April 2025 the PoliTopics Lambda short-circuits whenever DynamoDB already contains a task for the same `issueID`. This prevents accidental re-creation of prompt artifacts (S3) and DynamoDB items when the `/run` endpoint replays a time range that overlaps previous executions.

## Runtime behaviour

1. The handler trims each meeting’s `issueID`.
2. Before any S3 writes or token counting, it calls `TaskRepository.getTask(issueID)`.
3. If a task is returned, the Lambda logs `Task already exists in DynamoDB; skipping creation.` and moves on to the next meeting.

This check runs for every meeting, so even partial overlaps (some meetings new, some already processed) succeed without errors.

## Testing note

`npm test -- lambda_handler.run.test.ts --runInBand` includes a dedicated case that:

- Pre-configures the mocked repository to return an existing task.
- Ensures `createTask` is never invoked for that `issueID`.

Keep this file updated if the duplicate-avoidance behaviour or its logging changes.***
