aws_region              = "ap-northeast-3"
service_name            = "politopics"
environment             = "production"
prompt_bucket_name      = "politopics-prod-prompts"
error_bucket_name       = "politopics-prod-errors"
prompt_queue_name       = "politopics-prod-prompts"
lambda_package_bucket   = "politopics-artifacts"
lambda_package_key      = "production/politopics/lambda.zip"
lambda_memory_mb        = 1536
lambda_timeout_sec      = 420
schedule_expression     = "cron(0 15 * * ? *)"
environment_variables = {
  GEMINI_MAX_INPUT_TOKEN     = "6000"
  NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
}

tags = {
  Owner       = "platform-team"
  Criticality = "high"
}
