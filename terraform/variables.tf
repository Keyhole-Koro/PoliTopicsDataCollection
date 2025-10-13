variable "aws_region" {
  description = "AWS region to deploy resources"
  type        = string
}

variable "aws_profile" {
  description = "Optional named AWS CLI profile"
  type        = string
  default     = null
}

variable "environment" {
  description = "Deployment environment identifier (e.g. stage, production)"
  type        = string
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
  default     = null
}

variable "prompt_queue_name" {
  description = "SQS queue for prompt fan-out"
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

variable "use_localstack" {
  description = "When true, configure the AWS provider to target LocalStack endpoints"
  type        = bool
  default     = false
}

variable "localstack_endpoint" {
  description = "Base endpoint URL for LocalStack (e.g. http://127.0.0.1:4566)"
  type        = string
  default     = null
}

variable "localstack_access_key" {
  description = "Static access key used for LocalStack authentication"
  type        = string
  default     = "test"
}

variable "localstack_secret_key" {
  description = "Static secret key used for LocalStack authentication"
  type        = string
  default     = "test"
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

variable "create_prompt_queue" {
  description = "Whether Terraform should create the prompt SQS queue"
  type        = bool
  default     = true
}

variable "existing_prompt_queue_url" {
  description = "Existing prompt queue URL (required when create_prompt_queue is false)"
  type        = string
  default     = null
}

variable "existing_prompt_queue_arn" {
  description = "Existing prompt queue ARN (required when create_prompt_queue is false)"
  type        = string
  default     = null
}

