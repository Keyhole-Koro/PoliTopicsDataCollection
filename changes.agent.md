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

### Changes After Review
- Also skip missing configuration/resource errors during Terraform import.
- Files changed:
  - `PoliTopicsDataCollection/terraform/scripts/import_all.sh`

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

Agent: Gemini
Date/Time: 2025-12-23 00:00 UTC
Keywords: payload, asset, naming convention
Topic: Rename 'payload' to 'asset' in relevant contexts
Details:
- Reviewed 'PoliTopicsDataCollection' for 'payload' references.
- Determined that existing 'payload' usages refer to generic data, API responses, or task prompts, not article assets, and thus no changes were required in this submodule.

Agent: Codex
Date/Time: 2025-12-28 07:26 UTC
Keywords: config, env, terraform, lambda, gemini, run
Topic: Require API keys and propagate APP_ENVIRONMENT
Details:
- Switched `src/config.ts` to require `GEMINI_API_KEY`, `RUN_API_KEY`, and `APP_ENVIRONMENT` at startup.
- Terraform now injects `GEMINI_API_KEY` and `RUN_API_KEY` into Lambda secrets and sets `APP_ENVIRONMENT` from the existing `environment` variable.
- Removed the separate `app_environment` Terraform input.
- Files changed:
  - `PoliTopicsDataCollection/src/config.ts`
  - `PoliTopicsDataCollection/terraform/main.tf`
  - `PoliTopicsDataCollection/terraform/variables.tf`
  - `PoliTopicsDataCollection/terraform/service/main.tf`
  - `PoliTopicsDataCollection/terraform/service/variables.tf`

Agent: Codex
Date/Time: 2025-12-29 12:08 JST
Keywords: node, docs, tooling
Topic: Standardize Node.js 22 requirement
Details:
- Updated DataCollection docs to require Node.js 22+.
- Files changed:
  - `PoliTopicsDataCollection/readme.md`
  - `PoliTopicsDataCollection/doc/terraform-localstack.md`

Agent: Gemini
Date/Time: 2026-01-15 JST
Keywords: cron, date-range, bugfix
Topic: Update default cron range to cover 21 days ago until today
Details:
- Changed `defaultCronRange` in `utils/range.ts` to set `until` to today (offset 0) instead of 21 days ago.
- Added unit test to verify the fix.
- Files changed:
  - `PoliTopicsDataCollection/src/utils/range.ts`
  - `PoliTopicsDataCollection/src/utils/range.test.ts`

Agent: Gemini
Date/Time: 2026-01-15 JST
Keywords: tests, range, http
Topic: Add comprehensive tests for range resolution
Details:
- Expanded `src/utils/range.test.ts` to cover `deriveRangeFromHttp` logic.
- Verifies that `from`/`until` parameters are respected when provided in GET/POST requests.
- Verifies that the range defaults to today when parameters are missing.
- Verifies that `defaultCronRange` returns the correct 21-day window.
- Files changed:
  - `PoliTopicsDataCollection/src/utils/range.test.ts`
