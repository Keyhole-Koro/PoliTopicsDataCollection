variable "prompt_bucket_name" {
  type = string
}

variable "error_bucket_name" {
  type    = string
  default = null
}

variable "tags" {
  type    = map(string)
  default = {}
}
