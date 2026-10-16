# Protects the server's hostname and makes Access its OAuth authorization server. MCP clients
# discover Access through the hostname's protected-resource metadata, register themselves
# through dynamic client registration, and send the resulting token on every call. Access
# then forwards an assertion the origin may verify.
resource "cloudflare_zero_trust_access_application" "server" {
  account_id = var.account_id
  name       = var.application_name
  type       = "self_hosted"
  domain     = var.hostname

  allowed_idps              = var.identity_provider_ids
  auto_redirect_to_identity = true
  app_launcher_visible      = false
  session_duration          = var.session_duration

  # Declared at Access's defaults; omitting them makes every plan try to unset them.
  enable_binding_cookie    = false
  options_preflight_bypass = false

  destinations = [{
    type = "public"
    uri  = var.hostname
  }]

  oauth_configuration = {
    enabled = true
    dynamic_client_registration = {
      enabled = true
      # Desktop and command-line clients complete OAuth on localhost or loopback.
      allow_any_on_localhost = true
      allow_any_on_loopback  = true
      # The portal's own callback, the clients' callbacks, then the dashboard's
      # "Authenticate server" callback.
      allowed_uris = concat(
        var.portal == null ? [] : ["https://${var.portal.portal_hostname}/servers-callback"],
        var.allowed_redirect_uris,
        ["https://dash.cloudflare.com/${var.account_id}/one/access-controls/ai-controls/mcp-server/oauth-callback/*"],
      )
    }
    grant = var.grant
  }

  policies = [for index, id in var.policy_ids : { id = id, precedence = index + 1 }]
}

# A tunnel origin is reached through a proxied CNAME to the tunnel. Access applies to the
# proxied hostname, so nothing reaches the tunnel without passing it.
resource "cloudflare_dns_record" "tunnel" {
  count = var.tunnel == null ? 0 : 1

  zone_id = var.tunnel.zone_id
  name    = var.hostname
  type    = "CNAME"
  content = "${var.tunnel.tunnel_id}.cfargotunnel.com"
  proxied = true
  ttl     = 1
}

# The server as an MCP server portal knows it. `auth_type` and `hostname` are create-only, so
# changing either replaces the server and detaches it from the portal.
resource "cloudflare_zero_trust_access_ai_controls_mcp_server" "server" {
  count = var.portal == null ? 0 : 1

  account_id         = var.account_id
  id                 = var.portal.server_id
  name               = var.portal.server_name
  hostname           = var.portal.url
  auth_type          = "oauth"
  description        = var.portal.description
  secure_web_gateway = false
}

# Decides whether the server is visible inside the portal. `mcp_server_id` belongs on the
# destination; set at the top level, the API accepts it and discards it.
resource "cloudflare_zero_trust_access_application" "portal_visibility" {
  count = var.portal == null ? 0 : 1

  account_id = var.account_id
  name       = var.portal.visibility_name
  type       = "mcp"

  allowed_idps              = var.identity_provider_ids
  auto_redirect_to_identity = true
  session_duration          = var.session_duration

  destinations = [{
    type          = "via_mcp_server_portal"
    mcp_server_id = cloudflare_zero_trust_access_ai_controls_mcp_server.server[0].id
  }]

  policies = [for index, id in var.policy_ids : { id = id, precedence = index + 1 }]
}
