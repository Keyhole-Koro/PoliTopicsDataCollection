bucket                  = "politopics-data-collection-local-state"
key                     = "politopics-data-collection/local.tfstate"
region                  = "ap-northeast-3"
endpoints = {
  s3 = "http://localhost:4666"
}
use_path_style         = true
skip_credentials_validation = true
skip_region_validation      = true
