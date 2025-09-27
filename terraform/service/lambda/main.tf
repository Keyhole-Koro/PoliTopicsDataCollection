variable "name_prefix" {
  type = string
}

variable "lambda_package_bucket" {
  type = string
}

variable "lambda_package_key" {
  type = string
}

variable "memory_mb" {
  type = number
}

variable "timeout_sec" {
  type = number
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "secret_environment_variables" {
  type    = map(string)
  default = {}
}

variable "prompt_bucket" {
  type = string
}

variable "error_bucket" {
  type = string
  default = null
}

variable "prompt_queue_arn" {
  type = string
}

variable "prompt_queue_url" {
  type = string
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "private_subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_group_ids" {
  type    = list(string)
  default = []
}

variable "tags" {
  type    = map(string)
  default = {}
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.name_prefix}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
  tags               = var.tags
}

resource "aws_iam_role_policy_attachment" "basic_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy_attachment" "sqs_execution" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole"
}

locals {
  env_vars = merge(
    {
      PROMPT_BUCKET    = var.prompt_bucket
      ERROR_BUCKET     = coalesce(var.error_bucket, "")
      PROMPT_QUEUE_URL = var.prompt_queue_url
      PROMPT_QUEUE_ARN = var.prompt_queue_arn
    },
    var.environment_variables,
    var.secret_environment_variables
  )
}

resource "aws_lambda_function" "this" {
  function_name = "${var.name_prefix}-fn"
  role          = aws_iam_role.lambda.arn
  handler       = "dist/lambda_handler.handler"
  runtime       = "nodejs22.x"
  s3_bucket     = var.lambda_package_bucket
  s3_key        = var.lambda_package_key
  memory_size   = var.memory_mb
  timeout       = var.timeout_sec

  environment {
    variables = local.env_vars
  }

  dynamic "vpc_config" {
    for_each = var.vpc_id != null && length(var.private_subnet_ids) > 0 ? [true] : []
    content {
      subnet_ids         = var.private_subnet_ids
      security_group_ids = var.security_group_ids
    }
  }

  tags = var.tags
}

resource "aws_lambda_event_source_mapping" "sqs_trigger" {
  event_source_arn = var.prompt_queue_arn
  function_name    = aws_lambda_function.this.arn
  batch_size       = 10
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

