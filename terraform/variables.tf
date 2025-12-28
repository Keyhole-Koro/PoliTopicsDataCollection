variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "environment" {
  description = "Deployment environment identifier (e.g. local)"
  type        = string
}

variable "app_environment" {
  description = "Application environment identifier (local, stage, prod)"
  type        = string
  default     = "local"
}

variable "service_name" {
  description = "Logical name for this service"
  type        = string
}

variable "prompt_bucket_name" {
  description = "S3 bucket for prompt payloads"
  type        = string
}

variable "error_bucket_name" {
  description = "S3 bucket for error logs"
  type        = string
}

variable "lambda_memory_mb" {
  description = "Lambda memory size in MB"
  type        = number
  default     = 1024
}

variable "lambda_timeout_sec" {
  description = "Lambda timeout in seconds"
  type        = number
  default     = 300
}

variable "environment_variables" {
  description = "Non-sensitive environment variables for the Lambda function"
  type        = map(string)
  default     = {}
}

variable "secret_environment_variables" {
  description = "Sensitive environment variables for the Lambda function (set via TF_VAR or CI secrets)"
  type        = map(string)
  default     = {}
}

variable "gemini_api_key" {
  description = "API key for accessing the Gemini API"
  type        = string
  sensitive   = true
  default     = ""
}

variable "run_api_key" {
  description = "API key required for /run endpoint"
  type        = string
  sensitive   = true
  default     = ""
}
variable "schedule_expression" {
  description = "EventBridge schedule expression (cron or rate)"
  type        = string
  default     = "cron(0 16 * * ? *)"
}

variable "tags" {
  description = "Common resource tags"
  type        = map(string)
  default     = {}
}

variable "api_route_key" {
  description = "HTTP API route key (e.g. POST /run)"
  type        = string
  default     = "POST /run"
}

variable "lambda_package_dir" {
  description = "Directory containing the built Lambda sources (defaults to ../dist)"
  type        = string
  default     = null
}

variable "lambda_package_output_path" {
  description = "Path where Terraform should write the packaged Lambda ZIP"
  type        = string
  default     = null
}

variable "enable_http_api" {
  description = "Whether to manage the API Gateway HTTP API resources"
  type        = bool
  default     = true
}

variable "llm_task_table_name" {
  description = "DynamoDB table name for LLM tasks"
  type        = string
}

variable "aws_access_key" {
  description = "Optional AWS access key (falls back to shared credentials or LocalStack defaults)"
  type        = string
  default     = null
}

variable "aws_secret_key" {
  description = "Optional AWS secret key (falls back to shared credentials or LocalStack defaults)"
  type        = string
  default     = null
}

variable "aws_session_token" {
  description = "Optional AWS session token"
  type        = string
  default     = null
}

variable "aws_endpoint_url" {
  description = "Custom AWS endpoint URL (set for LocalStack)"
  type        = string
  default     = null
}
