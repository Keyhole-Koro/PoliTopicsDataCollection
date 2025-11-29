variable "name_prefix" {
  type = string
}

variable "memory_mb" {
  type = number
}

variable "timeout_sec" {
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

variable "prompt_bucket" {
  type = string
}

variable "error_bucket" {
  type    = string
  default = null
}

variable "prompt_queue_arn" {
  type = string
}

variable "prompt_queue_url" {
  type = string
}

variable "schedule_expression" {
  type    = string
  default = "cron(0 16 * * ? *)"
}

variable "api_route_key" {
  type    = string
  default = "POST /run"
}

variable "enable_http_api" {
  type    = bool
  default = true
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "package_source_dir" {
  type    = string
  default = null
}

variable "package_output_path" {
  type    = string
  default = null
}
