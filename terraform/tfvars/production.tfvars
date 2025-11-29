aws_region          = "ap-northeast-3"
environment         = "production"
service_name        = "politopics"
prompt_bucket_name  = "politopics-data-collection-prompts-production"
error_bucket_name   = "politopics-data-collection-errors-production"
prompt_queue_name   = "politopics-data-collection-prompt-queue-production"
lambda_memory_mb    = 1024
lambda_timeout_sec  = 300
schedule_expression = "cron(0 22 * * ? *)"
api_route_key       = "POST /run"
enable_http_api     = true
environment_variables = {
  APP_ENV = "production"
}
tags = {
  Environment = "production"
}
