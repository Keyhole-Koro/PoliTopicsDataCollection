resource "aws_s3_bucket" "prompt" {
  bucket = var.prompt_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_versioning" "prompt" {
  bucket = aws_s3_bucket.prompt.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prompt" {
  bucket = aws_s3_bucket.prompt.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "prompt" {
  bucket                  = aws_s3_bucket.prompt.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "error" {
  bucket = var.error_bucket_name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "error" {
  bucket = aws_s3_bucket.error.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

output "prompt_bucket" {
  value = aws_s3_bucket.prompt.bucket
}

output "error_bucket" {
  value = aws_s3_bucket.error.bucket
}
