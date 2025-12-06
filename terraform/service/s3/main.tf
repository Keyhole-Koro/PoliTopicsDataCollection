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

output "error_bucket" {
  value = aws_s3_bucket.error.bucket
}
