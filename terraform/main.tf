terraform {
  #required_version = ""

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

  backend "s3" {}
}

locals {
  localstack_enabled        = var.use_localstack && var.localstack_endpoint != null && trimspace(var.localstack_endpoint) != ""
  localstack_endpoint       = local.localstack_enabled ? trimspace(var.localstack_endpoint) : null
  lambda_package_override   = var.lambda_package_dir == null ? "" : trimspace(var.lambda_package_dir)
  lambda_output_override    = var.lambda_package_output_path == null ? "" : trimspace(var.lambda_package_output_path)
  lambda_package_dir        = local.lambda_package_override != "" ? local.lambda_package_override : "${path.root}/../dist"
  lambda_package_output_path = local.lambda_output_override != "" ? local.lambda_output_override : "${path.root}/service/lambda/.build/${var.service_name}-${var.environment}.zip"
}

provider "aws" {
  region  = var.aws_region
  profile = local.localstack_enabled ? null : var.aws_profile

  access_key = local.localstack_enabled ? var.localstack_access_key : null
  secret_key = local.localstack_enabled ? var.localstack_secret_key : null

  skip_credentials_validation = local.localstack_enabled
  skip_requesting_account_id  = local.localstack_enabled
  skip_metadata_api_check     = local.localstack_enabled
  s3_use_path_style           = local.localstack_enabled

  dynamic "endpoints" {
    for_each = local.localstack_enabled ? [local.localstack_endpoint] : []
    content {
      apigateway = endpoints.value
      cloudwatch = endpoints.value
      events     = endpoints.value
      iam        = endpoints.value
      lambda     = endpoints.value
      s3         = endpoints.value
      sqs        = endpoints.value
      sts        = endpoints.value
    }
  }
}

module "service" {
  source = "./service"

  environment                = var.environment
  service_name               = var.service_name
  prompt_bucket_name         = var.prompt_bucket_name
  error_bucket_name          = var.error_bucket_name
  prompt_queue_name          = var.prompt_queue_name
  lambda_memory_mb           = var.lambda_memory_mb
  lambda_timeout_sec         = var.lambda_timeout_sec
  environment_variables      = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  schedule_expression        = var.schedule_expression
  tags                       = var.tags
  lambda_package_dir         = local.lambda_package_dir
  lambda_package_output_path = local.lambda_package_output_path
  create_prompt_queue        = var.create_prompt_queue
  existing_prompt_queue_url  = var.existing_prompt_queue_url
  existing_prompt_queue_arn  = var.existing_prompt_queue_arn
}
