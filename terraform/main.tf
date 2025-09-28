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

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile
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
}

