terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.12.0"
    }
  }
}

variable "queue_name" {
  description = "Name for the LocalStack SQS queue used in integration tests"
  type        = string
}

variable "aws_region" {
  description = "AWS region reported to the LocalStack AWS provider"
  type        = string
  default     = "ap-northeast-3"
}

variable "localstack_endpoint" {
  description = "Endpoint URL for the LocalStack edge service"
  type        = string
  default     = "http://127.0.0.1:4566"
}

provider "aws" {
  region                      = var.aws_region
  access_key                  = "test"
  secret_key                  = "test"
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true
  s3_use_path_style           = true

  endpoints {
    sqs = var.localstack_endpoint
  }
}

resource "aws_sqs_queue" "prompt" {
  name                       = var.queue_name
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
}

output "prompt_queue_url" {
  value = aws_sqs_queue.prompt.id
}

output "prompt_queue_name" {
  value = aws_sqs_queue.prompt.name
}

output "prompt_queue_arn" {
  value = aws_sqs_queue.prompt.arn
}
