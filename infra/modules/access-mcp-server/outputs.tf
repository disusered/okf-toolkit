output "url" {
  description = "The MCP endpoint a client is configured with."
  value       = "https://${var.hostname}/mcp"
}

output "hostname" {
  description = "The public hostname, for a tunnel's ingress rule."
  value       = var.hostname
}

output "application_aud" {
  description = "Audience tag of the protecting Access application, for an origin that verifies the Access assertion."
  value       = cloudflare_zero_trust_access_application.server.aud
}

output "portal_server_id" {
  description = "The portal's id for this server, or null when it is not registered in a portal."
  value       = var.portal == null ? null : cloudflare_zero_trust_access_ai_controls_mcp_server.server[0].id
}

output "portal_server_status" {
  description = "Sync status the portal reports for this server, or null when it is not registered in a portal. It must be healthy before the server's tools appear there."
  value       = var.portal == null ? null : cloudflare_zero_trust_access_ai_controls_mcp_server.server[0].status
}

output "portal_server_tools" {
  description = "Tools the portal discovered on this server, or null when it is not registered in a portal."
  value       = var.portal == null ? null : cloudflare_zero_trust_access_ai_controls_mcp_server.server[0].tools
}
