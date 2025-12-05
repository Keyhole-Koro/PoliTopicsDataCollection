aws_region          = "ap-northeast-3"
environment         = "local"
service_name        = "politopics"
prompt_bucket_name  = "politopics-data-collection-prompts-local"
error_bucket_name   = "politopics-data-collection-errors-local"
llm_task_table_name = "politopics-llm-tasks-local"
aws_endpoint_url    = "http://localstack:4566"
lambda_memory_mb    = 128
lambda_timeout_sec  = 120
schedule_expression = "rate(1 day)"
api_route_key       = "POST /run"
enable_http_api     = false
environment_variables = {
  APP_ENV                = "local"
  AWS_ENDPOINT_URL       = "http://localstack:4566"
  GEMINI_MAX_INPUT_TOKEN = "4096"
}
tags = {
  Environment = "local"
}
