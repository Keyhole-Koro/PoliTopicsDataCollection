aws_region           = "ap-northeast-3"
environment          = "prod"
service_name         = "politopics"
lambda_function_name = "poliopics-datacollection-prod"
prompt_bucket_name   = "politopics-data-collection-prompts-prod"
error_bucket_name    = "politopics-data-collection-errors-prod"
llm_task_table_name  = "politopics-llm-tasks-prod"
lambda_memory_mb     = 128
lambda_timeout_sec   = 300
schedule_expression  = "cron(0 20 * * ? *)"
api_route_key        = "POST /run"
enable_http_api      = true
environment_variables = {
  APP_ENV                    = "prod"
  GEMINI_MAX_INPUT_TOKEN     = "100000"
  NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
}
tags = {
  Environment = "prod"
}
