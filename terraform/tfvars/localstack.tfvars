aws_region                 = "ap-northeast-3"
aws_profile                = null
environment                = "local"
service_name               = "politopics"
prompt_bucket_name         = "politopics-prompts-local"
error_bucket_name          = "politopics-errors-local"
prompt_queue_name          = "politopics-prompt-queue-local"
use_localstack             = true
localstack_endpoint        = "http://127.0.0.1:4566"
localstack_access_key      = "test"
localstack_secret_key      = "test"
lambda_memory_mb           = 512
lambda_timeout_sec         = 120
schedule_expression        = "rate(1 day)"
api_route_key              = "POST /run"
environment_variables = {
  APP_ENV             = "local"
  AWS_ENDPOINT_URL    = "http://127.0.0.1:4566"
  GEMINI_MAX_INPUT_TOKEN = "4096"
}
tags = {
  Environment = "local"
}
