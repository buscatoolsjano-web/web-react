# mcp-proxy

Puerta del MCP del ERP en un dominio propio, para clientes que buscan los
metadatos de OAuth en la raíz del dominio (Grok). Reenvía `/mcp` a la Edge
Function `erp-mcp` de Supabase y sirve `/.well-known/oauth-protected-resource`.

- URL para el conector: `https://<dominio>/mcp`
- ChatGPT puede seguir usando la URL directa de Supabase; las dos andan.
- Deploy: proyecto de Vercel con esta carpeta como raíz (sin framework).
