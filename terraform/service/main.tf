locals {
  base_queue_name = trimspace(var.prompt_queue_name)
  queue_name      = local.base_queue_name != "" ? "${local.base_queue_name}-${var.environment}" : "${var.service_name}-${var.environment}-queue"
  name_prefix     = "${var.service_name}-${var.environment}"
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
  name                       = local.queue_name
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
  sqs_managed_sse_enabled    = true
  tags                       = local.tags
}

module "lambda" {
  source = "./lambda"

  name_prefix                  = local.name_prefix
  lambda_package_bucket        = var.lambda_package_bucket
  lambda_package_key           = var.lambda_package_key
  memory_mb                    = var.lambda_memory_mb
  timeout_sec                  = var.lambda_timeout_sec
  environment_variables        = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  prompt_bucket                = module.buckets.prompt_bucket
  error_bucket                 = module.buckets.error_bucket
  prompt_queue_arn             = aws_sqs_queue.prompt.arn
  prompt_queue_url             = aws_sqs_queue.prompt.id
  schedule_expression          = var.schedule_expression
  tags                         = local.tags
}

output "prompt_bucket_name" {
  value = module.buckets.prompt_bucket
}

output "error_bucket_name" {
  value = module.buckets.error_bucket
}

output "prompt_queue_url" {
  value = aws_sqs_queue.prompt.id
}

output "prompt_queue_arn" {
  value = aws_sqs_queue.prompt.arn
}

output "lambda_function_name" {
  value = module.lambda.function_name
}
