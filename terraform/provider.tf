terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.12.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }

}

provider "aws" {
  region = var.aws_region

  access_key = local.provider_custom_endpoint ? coalesce(var.aws_access_key, "test") : var.aws_access_key
  secret_key = local.provider_custom_endpoint ? coalesce(var.aws_secret_key, "test") : var.aws_secret_key
  token      = var.aws_session_token

  s3_use_path_style           = var.aws_endpoint_url != null
  skip_credentials_validation = var.aws_endpoint_url != null
  skip_requesting_account_id  = var.aws_endpoint_url != null
  skip_metadata_api_check     = var.aws_endpoint_url != null
  skip_region_validation      = var.aws_endpoint_url != null

  dynamic "endpoints" {
    for_each = var.aws_endpoint_url == null ? [] : [var.aws_endpoint_url]
    content {
      apigateway = endpoints.value
      cloudwatch = endpoints.value
      dynamodb   = endpoints.value
      events     = endpoints.value
      iam        = endpoints.value
      lambda     = endpoints.value
      logs       = endpoints.value
      s3         = endpoints.value
      scheduler  = endpoints.value
      sqs        = endpoints.value
      sts        = endpoints.value
    }
  }
}
