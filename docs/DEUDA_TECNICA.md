# Deuda técnica

Cosas que funcionan pero están mal nombradas, incompletas o pendientes de una
decisión. No son bugs: son costes conocidos que elegimos pagar más adelante.

---

## 1. `VITE_SUPABASE_ANON_KEY` ya no contiene una clave `anon`

**Qué pasa.** El 2026-09-09 se migraron las API keys de Supabase del formato
JWT (`anon` / `service_role`) al nuevo (`sb_publishable_…` / `sb_secret_…`), y
las JWT legacy quedaron **deshabilitadas**. La variable del frontend sigue
llamándose `VITE_SUPABASE_ANON_KEY` pero hoy contiene una **Publishable**.

**Por qué no se renombra ahora.** El nombre aparece en tres lugares acoplados:
[`.env.example`](../.env.example), [`src/lib/env.ts`](../src/lib/env.ts) y el
secret `VITE_SUPABASE_ANON_KEY` de GitHub Actions. Renombrarlo obliga a tocar
GitHub Secrets, y no vale la pena mover una credencial de producción por un
cambio cosmético mientras hay una migración de dominio abierta.

**Riesgo.** Ninguno de seguridad: la clave es publicable por diseño, viaja en
el bundle a propósito y RLS es lo que protege los datos. El riesgo es de
confusión — alguien puede leer «anon» y suponer que sigue habiendo una clave
JWT en juego.

**Cuándo saldarlo.** Cuando toque cambiar el secret de Actions por otro
motivo. El renombre es: `.env`, `.env.example`, `src/lib/env.ts`,
`.github/workflows/deploy.yml` y el secret del repositorio, todo junto.

**Relacionado.** La variable de los scripts administrativos sí se renombró
(`SUPABASE_SERVICE_ROLE_KEY` → `SUPABASE_SECRET_KEY`), porque no dependía de
ningún secret de CI.

---

## 2. `products_write` concede SELECT sobre productos borrados

**Qué pasa.** `products_write` es `PERMISSIVE` con `cmd = ALL`, así que
también se aplica a los SELECT, y su qual no incluye `deleted_at IS NULL`. Un
admin o employee puede leer productos borrados lógicamente, que
`products_select` prohíbe.

**Estado.** Latente: hoy hay **0** productos con `deleted_at`.

**Por qué no se toca todavía.** Es una decisión de seguridad, no de
performance, y se estaba trabajando en lo segundo. Ver
[`performance/RLS_COUNT_ANALISIS.md`](performance/RLS_COUNT_ANALISIS.md).

---

## 3. Sin cabecera HSTS

GitHub Pages redirige `http://app.buscatools.com` a HTTPS con un 301
permanente, pero no emite `Strict-Transport-Security`. La primera visita de un
navegador que teclee `http://` hace un salto en claro antes del redirect.

No es configurable en GitHub Pages. Se resolvería poniendo un CDN delante, lo
que es un cambio de infraestructura mayor que el problema.
