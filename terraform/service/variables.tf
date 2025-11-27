variable "environment" {
  type = string
}

variable "service_name" {
  type = string
}

variable "prompt_bucket_name" {
  type = string
}

variable "error_bucket_name" {
  type    = string
  default = null
}

variable "prompt_queue_name" {
  type = string
}



variable "lambda_memory_mb" {
  type = number
}

variable "lambda_timeout_sec" {
  type = number
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "secret_environment_variables" {
  type    = map(string)
  default = {}
}

variable "schedule_expression" {
  type    = string
  default = "cron(0 16 * * ? *)"
}

variable "tags" {
  type    = map(string)
  default = {}
}


variable "api_route_key" {
  type    = string
  default = "POST /run"
}

variable "enable_http_api" {
  type    = bool
  default = true
}

variable "lambda_package_dir" {
  type    = string
  default = null
}

variable "lambda_package_output_path" {
  type    = string
  default = null
}

variable "create_prompt_queue" {
  type    = bool
  default = true
}

variable "existing_prompt_queue_url" {
  type    = string
  default = null
}

variable "existing_prompt_queue_arn" {
  type    = string
  default = null
}
