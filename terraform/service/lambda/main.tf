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

resource "aws_iam_policy" "dynamodb_tasks" {
  name        = "${var.name_prefix}-dynamodb-tasks"
  description = "Allow Lambda to manage LLM tasks table"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:GetItem", "dynamodb:Query"]
        Resource = [
          var.task_table_arn,
          "${var.task_table_arn}/index/*"
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "dynamodb_tasks" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.dynamodb_tasks.arn
}

locals {
  prompt_bucket_arn = "arn:aws:s3:::${var.prompt_bucket}"
  error_bucket_name = var.error_bucket != null ? trimspace(var.error_bucket) : ""
  s3_write_resources = concat(
    ["${local.prompt_bucket_arn}/*"],
    local.error_bucket_name != "" ? ["arn:aws:s3:::${local.error_bucket_name}/*"] : [],
  )
  enable_s3_policy = length(local.s3_write_resources) > 0
}

resource "aws_iam_policy" "s3_write" {
  count       = local.enable_s3_policy ? 1 : 0
  name        = "${var.name_prefix}-s3-writes"
  description = "Allow Lambda to write prompt and log payloads to S3"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = local.s3_write_resources
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "s3_write" {
  count      = local.enable_s3_policy ? 1 : 0
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.s3_write[0].arn
}

locals {
  env_vars = merge(
    {
      PROMPT_BUCKET  = var.prompt_bucket
      ERROR_BUCKET   = var.error_bucket != null ? var.error_bucket : ""
      LLM_TASK_TABLE = var.task_table_name
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

locals {
  function_name_override = var.function_name_override != null ? trimspace(var.function_name_override) : ""
  function_name          = local.function_name_override != "" ? local.function_name_override : "${var.name_prefix}-data-collection-fn"
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = local.package_source_dir
  output_path = local.package_output_zip
}

resource "aws_lambda_function" "this" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  handler          = "lambda_handler.handler"
  runtime          = "nodejs22.x"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  memory_size      = var.memory_mb
  timeout          = var.timeout_sec

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
  count         = var.enable_http_api ? 1 : 0
  name          = "${var.name_prefix}-http"
  protocol_type = "HTTP"
  tags          = var.tags
}

resource "aws_apigatewayv2_integration" "lambda" {
  count                  = var.enable_http_api ? 1 : 0
  api_id                 = aws_apigatewayv2_api.http[0].id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.this.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "lambda" {
  count     = var.enable_http_api ? 1 : 0
  api_id    = aws_apigatewayv2_api.http[0].id
  route_key = var.api_route_key
  target    = "integrations/${aws_apigatewayv2_integration.lambda[0].id}"
}

resource "aws_apigatewayv2_stage" "default" {
  count       = var.enable_http_api ? 1 : 0
  api_id      = aws_apigatewayv2_api.http[0].id
  name        = "$default"
  auto_deploy = true
  tags        = var.tags
}

resource "aws_lambda_permission" "allow_http_api" {
  count         = var.enable_http_api ? 1 : 0
  statement_id  = "AllowHttpApiInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http[0].execution_arn}/*/*"
}

output "function_name" {
  value = aws_lambda_function.this.function_name
}

output "http_api_endpoint" {
  value = var.enable_http_api && length(aws_apigatewayv2_stage.default) > 0 ? aws_apigatewayv2_stage.default[0].invoke_url : ""
}
