variable "name_prefix" {
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

variable "api_route_key" {
  type    = string
  default = "POST /run"
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "package_source_dir" {
  type    = string
  default = null
}

variable "package_output_path" {
  type    = string
  default = null
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
  name               = "${var.name_prefix}-data-collection-lambda-role"
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
    var.secret_environment_variables,
  )
}

locals {
  package_source_override = var.package_source_dir == null ? "" : trimspace(var.package_source_dir)
  package_output_override = var.package_output_path == null ? "" : trimspace(var.package_output_path)
  package_source_dir      = local.package_source_override != "" ? local.package_source_override : "${path.root}/../dist"
  package_output_zip      = local.package_output_override != "" ? local.package_output_override : "${path.module}/.build/${var.name_prefix}.zip"
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.package_source_dir
  output_path = local.package_output_zip
}

resource "aws_lambda_function" "this" {
  function_name = "${var.name_prefix}-data-collection-fn"
  role          = aws_iam_role.lambda.arn
  handler       = "lambda_handler.handler"
  runtime       = "nodejs20.x"
  filename      = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size   = var.memory_mb
  timeout       = var.timeout_sec

  environment {
    variables = local.env_vars
  }

  tags = var.tags
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = "${var.name_prefix}-data-collection-schedule"
  schedule_expression = var.schedule_expression
  tags                = var.tags
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

resource "aws_apigatewayv2_api" "http" {
  name          = "${var.name_prefix}-http"
  protocol_type = "HTTP"
  tags          = var.tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.this.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lambda" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = var.api_route_key
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "allow_http_api" {
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "http_api_endpoint" {
  value = aws_apigatewayv2_stage.default.invoke_url
}
