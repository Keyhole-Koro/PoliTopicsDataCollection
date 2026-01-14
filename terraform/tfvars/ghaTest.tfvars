aws_region          = "ap-northeast-3"
aws_endpoint_url    = "http://localhost:4666"
aws_access_key      = "test"
aws_secret_key      = "test"
environment         = "local"
service_name        = "politopics"
lambda_function_name = "poliopics-datacollection-local"
prompt_bucket_name  = "politopics-prompts"
error_bucket_name   = "politopics-data-collection-errors-local"
llm_task_table_name = "politopics-llm-tasks-local"
lambda_memory_mb    = 128
lambda_timeout_sec  = 120
schedule_expression = "rate(1 day)"
api_route_key       = "POST /run"
enable_http_api     = false
environment_variables = {
  APP_ENV                = "local"
  AWS_ENDPOINT_URL       = "http://localhost:4666"
  GEMINI_MAX_INPUT_TOKEN = "4096"
  NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
}
tags = {
  Environment = "local"
}
