variable "queue_name" {
  type = string
}

variable "environment" {
  type    = string
  default = ""
}

variable "tags" {
  type    = map(string)
  default = {}
}

locals {
  suffix    = trimspace(var.environment)
  finalName = suffix != "" ? "${var.queue_name}-${suffix}" : var.queue_name
}

resource "aws_sqs_queue" "this" {
  name                       = local.finalName
  visibility_timeout_seconds = 30
  message_retention_seconds  = 345600
  receive_wait_time_seconds  = 10
  sqs_managed_sse_enabled    = true
  tags                       = var.tags
}

output "queue_url" {
  value = aws_sqs_queue.this.id
}

output "queue_arn" {
  value = aws_sqs_queue.this.arn
}