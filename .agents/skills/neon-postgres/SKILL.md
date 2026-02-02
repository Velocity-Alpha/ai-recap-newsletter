---
name: neon-postgres
description: Guides and best practices for Neon focused on the Neon CLI, the Node.js/TypeScript serverless driver (@neondatabase/serverless), and the Neon MCP server.
---

# Neon Serverless Postgres

This skill focuses on three areas only:

1. **Neon CLI** (terminal workflows, automation)
2. **Node.js/TypeScript serverless driver** (`@neondatabase/serverless`)
3. **Neon MCP server** (AI assistant integration)

## Neon Documentation

Always reference the Neon documentation before making Neon-related claims. The documentation is the source of truth for all Neon-related information.

Below you'll find a list of resources organized by area of concern. This is meant to support you find the right documentation pages to fetch and add a bit of additonal context.

You can use the `curl` commands to fetch the documentation page as markdown:

**Documentation:**

```bash
# Get list of all Neon docs
curl https://neon.com/llms.txt

# Fetch any doc page as markdown
curl -H "Accept: text/markdown" https://neon.com/docs/<path>
```

Don't guess docs pages. Use the `llms.txt` index to find the relevant URL or follow the links in the resources below.

## Overview of Resources

Reference the appropriate resource file based on the user's needs:

### Core Guides

| Area             | Resource                    | When to Use                                             |
| ---------------- | --------------------------- | ------------------------------------------------------- |
| Developer Tools  | `references/devtools.md`    | Neon MCP server setup and usage (`neon init`)           |
| Neon CLI         | `references/neon-cli.md`    | Terminal workflows, scripts, CI/CD pipelines            |
| Serverless Driver| `references/neon-serverless.md` | Node.js/TypeScript serverless driver usage           |
