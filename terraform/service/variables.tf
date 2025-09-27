﻿variable "environment" {
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

variable "lambda_package_bucket" {
  type = string
}

variable "lambda_package_key" {
  type = string
}

variable "lambda_memory_mb" {
  type = number
}

variable "lambda_timeout_sec" {
  type = number
}

variable "vpc_id" {
  type    = string
  default = null
}

variable "private_subnet_ids" {
  type    = list(string)
  default = []
}

variable "security_group_ids" {
  type    = list(string)
  default = []
}

variable "environment_variables" {
  type    = map(string)
  default = {}
}

variable "secret_environment_variables" {
  type    = map(string)
  default = {}
}

variable "tags" {
  type    = map(string)
  default = {}
}
