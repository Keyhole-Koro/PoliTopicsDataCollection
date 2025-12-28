locals {
  provider_endpoint          = var.aws_endpoint_url == null ? "" : trimspace(var.aws_endpoint_url)
  provider_custom_endpoint   = local.provider_endpoint != ""
  lambda_package_override    = var.lambda_package_dir == null ? "" : trimspace(var.lambda_package_dir)
  lambda_output_override     = var.lambda_package_output_path == null ? "" : trimspace(var.lambda_package_output_path)
  lambda_package_dir         = local.lambda_package_override != "" ? local.lambda_package_override : "${path.root}/../dist"
  lambda_package_output_path = local.lambda_output_override != "" ? local.lambda_output_override : "${path.root}/service/lambda/.build/${var.service_name}-${var.environment}.zip"
}

module "service" {
  source = "./service"

  environment                  = var.environment
  service_name                 = var.service_name
  prompt_bucket_name           = var.prompt_bucket_name
  error_bucket_name            = var.error_bucket_name
  llm_task_table_name          = var.llm_task_table_name
  lambda_memory_mb             = var.lambda_memory_mb
  lambda_timeout_sec           = var.lambda_timeout_sec
  environment_variables        = var.environment_variables
  secret_environment_variables = var.secret_environment_variables
  gemini_api_key               = var.gemini_api_key
  run_api_key                  = var.run_api_key
  schedule_expression          = var.schedule_expression
  tags                         = var.tags
  lambda_package_dir           = local.lambda_package_dir
  lambda_package_output_path   = local.lambda_package_output_path
  api_route_key                = var.api_route_key
  enable_http_api              = var.enable_http_api
}
