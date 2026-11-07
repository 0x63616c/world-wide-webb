variable "account_id" {
  type      = string
  sensitive = true
}
variable "zone_id" {
  type      = string
  sensitive = true
}
variable "zone_name" {
  type    = string
  default = "worldwidewebb.co"
}
variable "allowed_email" {
  type      = string
  sensitive = true
}
variable "apply_access_gate" {
  description = "Preserve current explicit opt-in to the zone-wide deny floor."
  type        = bool
  default     = false
}

variable "state_passphrase" {
  type      = string
  sensitive = true
  validation {
    condition     = length(var.state_passphrase) >= 32
    error_message = "Use a separately backed-up state passphrase of at least 32 characters."
  }
}
