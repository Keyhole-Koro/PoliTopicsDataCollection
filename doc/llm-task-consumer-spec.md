# PoliTopics LLM Task Consumer Specification

This specification explains how downstream workers should consume LLM tasks persisted in DynamoDB and S3. The schema and flow are identical across LocalStack and real AWS environments.

## 1. DynamoDB Table

- **Table name**: `PoliTopics-llm-tasks` (override via `LLM_TASK_TABLE`)
- **Partition key**: `pk` (meeting `issueID`, string)
- **GSI `StatusIndex`**
  - Partition key: `status`
  - Sort key: `createdAt`
  - Purpose: dequeue `status = "pending"` tasks in FIFO order

### 1.1 Item schema

| Field | Type | Description |
| --- | --- | --- |
| `pk` | string | Meeting `issueID` (primary key) |
| `status` | `"pending"` or `"completed"` | Workflow stage |
| `llm` | string | e.g. `"gemini"` |
| `llmModel` | string | e.g. `"gemini-2.5-pro"` |
| `retryAttempts` | number | Retry counter (starts at 0) |
| `createdAt` / `updatedAt` | ISO string | Creation / last update timestamp |
| `processingMode` | `"direct"` or `"chunked"` | Execution mode |
| `prompt_url` | string | Reduce payload in S3 |
| `meeting` | object | `issueID`, `nameOfMeeting`, `nameOfHouse`, `date`, `numberOfSpeeches` |
| `result_url` | string | Final reduce output target |
| `chunks` | `ChunkItem[]` | Present only for chunked tasks |

`ChunkItem` structure:

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | e.g. `CHUNK#0` |
| `prompt_key` | string | `prompts/<issueID>_<indices>.json` |
| `prompt_url` | string | S3 URL for the chunk prompt |
| `result_url` | string | `results/<issueID>_<indices>_result.json` |
| `status` | `"notReady"` or `"ready"` | Chunk progress |

## 2. S3 Artifacts

| Kind | Key example | Contents |
| --- | --- | --- |
| Chunk prompt | `prompts/121805261X00320250919_0-1-2.json` | `prompt`, `speeches`, `speechIds`, `indices` |
| Direct reduce prompt | `prompts/reduce/<issueID>_direct.json` | `mode: "direct"`, chunk + reduce templates, meeting info, range |
| Chunked reduce prompt | `prompts/reduce/<issueID>.json` | `mode: "chunked"`, `chunks`, `chunkResultUrls` |
| Chunk result | `results/<issueID>_<indices>_result.json` | Chunk LLM output |
| Reduce result | `results/<issueID>_reduce.json` | Reduce LLM output |

Bucket name defaults to `politopics-prompts` (override via env). URLs in the tasks follow `s3://politopics-prompts/<key>`.

## 3. Status Lifecycle

1. **pending** – freshly created; retrieved via `getNextPending()` (uses `StatusIndex`).
2. **Chunked execution**
   - Process each chunk, write outputs to `chunk.result_url`.
   - Call `TaskRepository.markChunkReady(issueID, chunkId)` after each chunk to flip `status` to `"ready"`.
3. **Reduce** – once all chunks are ready (or the task is direct), execute the reduce prompt and store the final output at `result_url`.
4. **completed** – call `TaskRepository.markTaskSucceeded(issueID)` after the reduce succeeds; `status` becomes `"completed"` and `updatedAt` refreshes.

## 4. Consuming Chunks

1. Use `TaskRepository.getNextPending(limit)` to fetch candidates.
2. Branch on `processingMode`:
   - `direct`: load the reduce payload at `prompt_url`, run the LLM, write to `result_url`, then call `markTaskSucceeded`.
   - `chunked`:
     1. Iterate over `chunks`, download each chunk `prompt_url`, and run the LLM.
     2. Persist chunk outputs to `chunk.result_url`.
     3. Mark each chunk ready via `markChunkReady(issueID, chunk.id)`.
     4. After all chunks are ready, download the reduce prompt (`prompt_url`), gather `chunkResultUrls`, run the reduce LLM, and write the result to `result_url`.
     5. Call `markTaskSucceeded(issueID)` to finalize.

## 5. Example Chunked Task

```jsonc
{
  "pk": "121805261X00320250919",
  "status": "pending",
  "processingMode": "chunked",
  "prompt_url": "s3://politopics-prompts/prompts/reduce/121805261X00320250919.json",
  "result_url": "s3://politopics-prompts/results/121805261X00320250919_reduce.json",
  "meeting": {
    "issueID": "121805261X00320250919",
    "nameOfMeeting": "Science Committee",
    "nameOfHouse": "House of Representatives",
    "date": "2025-09-19",
    "numberOfSpeeches": 120
  },
  "chunks": [
    {
      "id": "CHUNK#0",
      "prompt_key": "prompts/121805261X00320250919_0-1-2-3.json",
      "prompt_url": "s3://politopics-prompts/prompts/121805261X00320250919_0-1-2-3.json",
      "result_url": "s3://politopics-prompts/results/121805261X00320250919_0-1-2-3_result.json",
      "status": "notReady"
    }
  ]
}
```

## 6. Indexing & Query Tips

- **StatusIndex (status, createdAt)** – pull the oldest pending tasks. `TaskRepository.getNextPending(limit)` already queries this index with `ScanIndexForward: true`.
- **Primary key lookups** – `TaskRepository.getTask(issueID)` performs direct reads and the update methods reuse the same key.
- The StatusIndex is the only secondary index. If you need alternative filters (e.g., by meeting metadata), consider adding new indexes or projections.

## 7. LocalStack Verification

- With `LOCALSTACK_URL` set, you can run `src/lambda_handler.mock.test.ts` or `src/DynamoDB/tasks.localstack.test.ts` to exercise the full pipeline locally.
- Keep `CLEANUP_LOCALSTACK_*` unset/`0` to leave tables and S3 objects intact for inspection via DynamoDB Admin or the LocalStack dashboard.

---

Consumers should poll DynamoDB for pending tasks, fetch the corresponding S3 payloads, and follow the chunk/reduce flow above. You can extend the basic contract with bespoke retry logic, monitoring, or additional metadata as needed.
