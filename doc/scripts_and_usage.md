# Scripts and Usage (PoliTopicsDataCollection)
[Japanese Version](./jp/scripts_and_usage.md)

This document lists runnable scripts and common workflows for the DataCollection module.
Paths are relative to `PoliTopicsDataCollection`.

## NPM scripts
- `npm run build`: Build the Lambda bundle into `dist/` (runs `scripts/build-lambda.js`).
- `npm run postbuild`: Rewrite TS path aliases in the build output.
- `npm run test`: Run Jest with `APP_ENVIRONMENT=localstackTest` (expects LocalStack).
- `npm run test:gha`: Run Jest with `APP_ENVIRONMENT=ghaTest`.
- `npm run ensure:localstack`: Verify LocalStack resources and create them if missing.
- `npm run pretest`: Same as `ensure:localstack`.

## Helper scripts
- `scripts/build-lambda.js`: Clean `dist/`, compile TS, copy package metadata, install prod deps.
- `scripts/ensure-localstack.sh`: Check LocalStack buckets/tables/lambda. Supports `--check-only` and an environment arg (default: `DATACOLLECTION_LOCALSTACK_ENV` or `local`).
- `scripts/localstack_apply.sh`: Build, create the state bucket, import resources, and run Terraform plan/apply for LocalStack or ghaTest.
- `terraform/scripts/create-state-bucket.sh <local|ghaTest|stage|prod>`: Create/verify the Terraform state bucket.
- `terraform/scripts/import_all.sh <local|ghaTest|stage|prod>`: Import existing resources into Terraform state.

## Use cases

### Run tests against LocalStack
1. Start LocalStack (via the root `docker-compose.yml`).
2. Ensure resources:

```bash
npm run ensure:localstack
```

3. Run tests:

```bash
npm run test
```

### Bootstrap LocalStack infra
```bash
bash scripts/localstack_apply.sh local
```

Optional verification only:

```bash
bash scripts/ensure-localstack.sh --check-only
```

### Build Lambda artifacts for deploy
```bash
npm run build
```

Use the contents of `dist/` for deployment.

## Related docs
- `doc/terraform-localstack.md`
