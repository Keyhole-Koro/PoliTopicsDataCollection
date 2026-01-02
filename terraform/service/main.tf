locals {
  name_prefix = "${var.service_name}-${var.environment}"
  tags = merge(
    {
      Service     = var.service_name
      Environment = var.environment
    },
    var.tags
  )

  lambda_env_vars = merge(
    var.environment_variables,
    {
      PROMPT_BUCKET    = var.prompt_bucket_name
      APP_ENVIRONMENT  = var.environment
    },
  )
}

module "buckets" {
  source = "./s3"

  prompt_bucket_name = var.prompt_bucket_name
  error_bucket_name  = var.error_bucket_name
  tags               = local.tags
}

module "tasks_table" {
  source = "./dynamodb"

  table_name = var.llm_task_table_name
  tags       = local.tags
}

module "lambda" {
  source = "./lambda"

  name_prefix                  = local.name_prefix
  memory_mb                    = var.lambda_memory_mb
  timeout_sec                  = var.lambda_timeout_sec
  environment_variables        = local.lambda_env_vars
  secret_environment_variables = merge(
    var.secret_environment_variables,
    {
      GEMINI_API_KEY        = var.gemini_api_key
      RUN_API_KEY           = var.run_api_key
      DISCORD_WEBHOOK_ERROR = var.discord_webhook_error
      DISCORD_WEBHOOK_WARN  = var.discord_webhook_warn
      DISCORD_WEBHOOK_BATCH = var.discord_webhook_batch
    },
  )
  api_route_key                = var.api_route_key
  prompt_bucket                = module.buckets.prompt_bucket
  error_bucket                 = module.buckets.error_bucket
  task_table_name              = module.tasks_table.table_name
  task_table_arn               = module.tasks_table.table_arn
  schedule_expression          = var.schedule_expression
  tags                         = local.tags
  package_source_dir           = var.lambda_package_dir
  package_output_path          = var.lambda_package_output_path
  enable_http_api              = var.enable_http_api
}

output "prompt_bucket_name" {
  value = module.buckets.prompt_bucket
}

output "error_bucket_name" {
  value = module.buckets.error_bucket
}
output "task_table_name" {
  value = module.tasks_table.table_name
}

output "lambda_function_name" {
  value = module.lambda.function_name
}
