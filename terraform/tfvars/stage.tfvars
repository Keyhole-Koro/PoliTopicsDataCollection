aws_region              = "ap-northeast-3"
service_name            = "politopics"
environment             = "stage"
prompt_bucket_name      = "politopics-stage-prompts"
error_bucket_name       = "politopics-stage-errors"
prompt_queue_name       = "politopics-stage-prompts"
lambda_package_bucket   = "politopics-artifacts"
lambda_package_key      = "stage/politopics/lambda.zip"
lambda_memory_mb        = 1024
lambda_timeout_sec      = 300
vpc_id                  = "vpc-xxxxxxxx"
private_subnet_ids      = ["subnet-aaaaaaa", "subnet-bbbbbbb"]
security_group_ids      = ["sg-xxxxxxxx"]
environment_variables = {
  GEMINI_MAX_INPUT_TOKEN     = "6000"
  NATIONAL_DIET_API_ENDPOINT = "https://kokkai.ndl.go.jp/api/meeting"
}

tags = {
  Owner = "platform-team"
}