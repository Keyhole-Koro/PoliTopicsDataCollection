terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.12.0"
    }
  }
}

variable "table_name" {
  description = "Name for the LocalStack DynamoDB table used in integration tests"
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
    dynamodb = var.localstack_endpoint
  }
}

resource "aws_dynamodb_table" "tasks" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "StatusIndex"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }
}

output "table_name" {
  value = aws_dynamodb_table.tasks.name
}

output "table_arn" {
  value = aws_dynamodb_table.tasks.arn
}
