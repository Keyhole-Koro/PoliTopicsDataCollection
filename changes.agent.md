# changes.agent.md

Agent: Codex
Date/Time: 2025-12-22 03:38 UTC
Keywords: localstack, terraform, state-bucket
Topic: Align state bucket creation with backend config
Details:
- Updated the DataCollection state-bucket script to use the local backend bucket name and a consistent env argument format.

Agent: Codex
Date/Time: 2025-12-22 03:41 UTC
Keywords: terraform, import, localstack
Topic: Ignore missing resources during import
Details:
- Updated the DataCollection Terraform import script to skip missing remote objects instead of failing.

Agent: Gemini
Date/Time: 2025-12-22 13:00 JST
Keywords: s3, config, localstack
Topic: Unify prompt bucket name
Details:
- Renamed `politopics-data-collection-prompts-local` to `politopics-prompts` to match Recap configuration.
- Files changed:
  - `terraform/tfvars/localstack.tfvars`
  - `src/config.ts`
  - `src/testUtils/testEnv.ts`