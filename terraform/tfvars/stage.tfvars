aws_region          = "ap-northeast-3"
environment         = "stage"
service_name        = "politopics"
prompt_bucket_name  = "politopics-data-collection-prompts-stage"
error_bucket_name   = "politopics-data-collection-errors-stage"
llm_task_table_name = "politopics-llm-tasks-stage"
lambda_memory_mb    = 128
lambda_timeout_sec  = 300
schedule_expression = "cron(0 22 * * ? *)"
api_route_key       = "POST /run"
enable_http_api     = true
environment_variables = {
  APP_ENV                    = "stage"
  GEMINI_MAX_INPUT_TOKEN     = "100000"
  NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
}
tags = {
  Environment = "stage"
}
