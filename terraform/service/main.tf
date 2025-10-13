locals {
  base_queue_name = trimspace(var.prompt_queue_name)
  queue_name      = local.base_queue_name != "" ? "${local.base_queue_name}-${var.environment}" : "${var.service_name}-${var.environment}-queue"
  name_prefix     = "${var.service_name}-${var.environment}"
  create_queue    = var.create_prompt_queue
  existing_queue_url = var.existing_prompt_queue_url == null ? "" : trimspace(var.existing_prompt_queue_url)
  existing_queue_arn = var.existing_prompt_queue_arn == null ? "" : trimspace(var.existing_prompt_queue_arn)
  need_existing_queue_lookup = !local.create_queue && (local.existing_queue_url == "" || local.existing_queue_arn == "")
  tags = merge(
    {
      Service     = var.service_name
      Environment = var.environment
    },
    var.tags
  )
}

module "buckets" {
  source = "./s3"

  prompt_bucket_name = var.prompt_bucket_name
  error_bucket_name  = var.error_bucket_name
  tags               = local.tags
}

resource "aws_sqs_queue" "prompt" {
  count                      = local.create_queue ? 1 : 0
  name                       = local.queue_name
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
  sqs_managed_sse_enabled    = true
  tags                       = local.tags
}

data "aws_sqs_queue" "existing" {
  count = local.need_existing_queue_lookup ? 1 : 0
  name  = local.queue_name
}

locals {
  resolved_existing_queue_url = local.need_existing_queue_lookup ? data.aws_sqs_queue.existing[0].url : local.existing_queue_url
  resolved_existing_queue_arn = local.need_existing_queue_lookup ? data.aws_sqs_queue.existing[0].arn : local.existing_queue_arn
  prompt_queue_url            = local.create_queue ? aws_sqs_queue.prompt[0].id : local.resolved_existing_queue_url
  prompt_queue_arn            = local.create_queue ? aws_sqs_queue.prompt[0].arn : local.resolved_existing_queue_arn
}

module "lambda" {
  source = "./lambda"

  name_prefix                  = local.name_prefix
  memory_mb                    = var.lambda_memory_mb
  timeout_sec                  = var.lambda_timeout_sec
  environment_variables        = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  api_route_key               = var.api_route_key
  prompt_bucket                = module.buckets.prompt_bucket
  error_bucket                 = module.buckets.error_bucket
  prompt_queue_arn             = local.prompt_queue_arn
  prompt_queue_url             = local.prompt_queue_url
  schedule_expression          = var.schedule_expression
  tags                         = local.tags
  package_source_dir           = var.lambda_package_dir
  package_output_path          = var.lambda_package_output_path
}

output "prompt_bucket_name" {
  value = module.buckets.prompt_bucket
}

output "error_bucket_name" {
  value = module.buckets.error_bucket
}

output "prompt_queue_url" {
  value = local.prompt_queue_url
}

output "prompt_queue_arn" {
  value = local.prompt_queue_arn
}

output "prompt_queue_created" {
  value = local.create_queue
}

output "lambda_function_name" {
  value = module.lambda.function_name
}
