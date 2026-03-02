# Nexus Agent — Admin Operations

> Back to [Usage Overview](USAGE.md) | [Configuration](USAGE_CONFIGURATION.md)

---

This guide covers admin-only responsibilities and governance workflows.

## User Management

Manage account lifecycle, role assignment, and permission scope.

![User management (test env)](images/usage-settings-users.png)

Common operations:
- Activate/deactivate accounts
- Promote/demote user roles
- Grant/revoke feature permissions

---

## Authentication Providers

Configure OAuth providers from the Settings UI.

![Authentication settings (test env)](images/usage-settings-authentication.png)

| Provider | Required Fields |
|----------|------------------|
| Azure AD | Client ID, Client Secret, Tenant ID |
| Google | Client ID, Client Secret |
| Discord | Bot Token, Application ID |

---

## Custom Tool Governance

Review agent-created tools and enforce safety boundaries.

![Custom tools settings (test env)](images/usage-settings-custom-tools.png)

Built-in toolmaker operations:

| Tool | Purpose | Default Approval |
|------|---------|------------------|
| `nexus_create_tool` | Create tool | Required |
| `nexus_list_custom_tools` | List tools | Not required |
| `nexus_delete_custom_tool` | Delete tool | Required |

Safety baseline:
- VM sandbox execution
- Restricted runtime surface (no unrestricted fs/process)
- Timeout-bound tool execution

---

## Policy & Risk Controls

Admins should regularly review:
- Tool approval defaults
- Proactive-enabled surfaces
- Channel routing for alerts
- Credential hygiene and encryption key consistency
