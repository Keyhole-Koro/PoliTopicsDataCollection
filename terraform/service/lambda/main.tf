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
  type    = string
  default = null
}

variable "prompt_queue_arn" {
  type = string
}

variable "prompt_queue_url" {
  type = string
}

variable "schedule_expression" {
  type    = string
  default = "cron(0 16 * * ? *)"
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

locals {
  env_vars = merge(
    {
      PROMPT_BUCKET    = var.prompt_bucket
      ERROR_BUCKET     = coalesce(var.error_bucket, "")
      PROMPT_QUEUE_URL = var.prompt_queue_url
      PROMPT_QUEUE_ARN = var.prompt_queue_arn
    },
    var.environment_variables,
    var.secret_environment_variables,
  )
}

resource "aws_lambda_function" "this" {
  function_name = "${var.name_prefix}-fn"
  role          = aws_iam_role.lambda.arn
  handler       = "dist/lambda_handler.handler"
  runtime       = "nodejs20.x"
  s3_bucket     = var.lambda_package_bucket
  s3_key        = var.lambda_package_key
  memory_size   = var.memory_mb
  timeout       = var.timeout_sec

  environment {
    variables = local.env_vars
  }

  tags = var.tags
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = "${var.name_prefix}-schedule"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "schedule" {
  rule      = aws_cloudwatch_event_rule.schedule.name
  target_id = "${var.name_prefix}-lambda"
  arn       = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule.arn
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}
