terraform {
  required_version = "~> 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {}
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
}

module "service" {
  source = "./service"

  environment           = var.environment
  service_name          = var.service_name
  prompt_bucket_name    = var.prompt_bucket_name
  error_bucket_name     = var.error_bucket_name
  prompt_queue_name     = var.prompt_queue_name
  lambda_package_bucket = var.lambda_package_bucket
  lambda_package_key    = var.lambda_package_key
  lambda_memory_mb      = var.lambda_memory_mb
  lambda_timeout_sec    = var.lambda_timeout_sec
  vpc_id                = var.vpc_id
  private_subnet_ids    = var.private_subnet_ids
  security_group_ids    = var.security_group_ids

  environment_variables         = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  tags                  = var.tags
}
