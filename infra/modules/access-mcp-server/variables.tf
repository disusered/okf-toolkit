variable "account_id" {
  description = "Cloudflare account that owns the Access applications."
  type        = string
}

variable "hostname" {
  description = "Public hostname of the MCP server, such as knowledge-mcp.example.com. One level below the zone apex keeps it inside the zone's universal certificate."
  type        = string
}

variable "application_name" {
  description = "Name of the self_hosted Access application that protects the hostname."
  type        = string
}

variable "identity_provider_ids" {
  description = "Access identity providers a person may sign in with."
  type        = list(string)
}

variable "policy_ids" {
  description = "Access policies, in precedence order, that decide who may reach the server."
  type        = list(string)
}

variable "session_duration" {
  description = "How long an Access session lasts on the application itself."
  type        = string
  default     = "24h"
}

variable "allowed_redirect_uris" {
  description = "OAuth redirect URIs dynamic client registration accepts, besides any localhost or loopback URI. The defaults cover Claude and ChatGPT connectors."
  type        = list(string)
  default = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
  ]
}

variable "grant" {
  description = "OAuth grant lifetimes. The access token is re-checked against policy on every refresh, so a short token with a long session revokes a removed person quickly without daily sign-ins."
  type = object({
    access_token_lifetime = string
    session_duration      = string
  })
  default = {
    access_token_lifetime = "15m"
    session_duration      = "730h"
  }
}

variable "tunnel" {
  description = "Route the hostname to a Cloudflare Tunnel. Null when the origin is a Worker custom domain, which owns its own DNS record."
  type = object({
    zone_id   = string
    tunnel_id = string
  })
  default = null
}

variable "portal" {
  description = "Register the server in a Cloudflare MCP server portal. Null to publish the hostname directly only."
  type = object({
    portal_hostname = string
    server_id       = string
    server_name     = string
    description     = string
    url             = string
    visibility_name = string
  })
  default = null
}
