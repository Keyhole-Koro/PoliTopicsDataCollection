locals {
  name_prefix = "${var.service_name}-${var.environment}"
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

module "queue" {
  source = "./sqs"

  queue_name  = var.prompt_queue_name
  environment = var.environment
  tags        = local.tags
}

module "lambda" {
  source = "./lambda"

  name_prefix           = local.name_prefix
  lambda_package_bucket = var.lambda_package_bucket
  lambda_package_key    = var.lambda_package_key
  memory_mb             = var.lambda_memory_mb
  timeout_sec           = var.lambda_timeout_sec
  environment_variables          = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  prompt_bucket         = module.buckets.prompt_bucket
  error_bucket          = module.buckets.error_bucket
  prompt_queue_arn      = module.queue.queue_arn
  prompt_queue_url      = module.queue.queue_url
  vpc_id                = var.vpc_id
  private_subnet_ids    = var.private_subnet_ids
  security_group_ids    = var.security_group_ids
  tags                  = local.tags
}

output "prompt_bucket_name" {
  value = module.buckets.prompt_bucket
}

output "error_bucket_name" {
  value = module.buckets.error_bucket
}

output "prompt_queue_url" {
  value = module.queue.queue_url
}

output "prompt_queue_arn" {
  value = module.queue.queue_arn
}

output "lambda_function_name" {
  value = module.lambda.function_name
}
