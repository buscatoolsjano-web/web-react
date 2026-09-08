# BUSCATOOLS — web-react

Nueva versión del sistema de gestión de BUSCATOOLS: React + TypeScript +
Vite + Supabase.

> **Estado: Fase 1 — base del proyecto.**
> Todavía no hay módulos de negocio migrados. La migración es progresiva,
> módulo por módulo. Ver [`MIGRATION_STATUS.md`](MIGRATION_STATUS.md).

## Relación con el sistema legacy

| | Legacy | Esta versión |
|---|---|---|
| Repo | `buscatoolsjano-web/Buscatools` | `buscatoolsjano-web/web-react` |
| Supabase | `hnyngsejohkmlaccpkux` | `uaxcfufvapzulqvynanp` |
| URL | `…github.io/Buscatools/` | https://buscatoolsjano-web.github.io/web-react/ |

Los dos sistemas están **completamente aislados**: repos distintos,
proyectos de Supabase distintos, sin datos compartidos.

**El legacy es READ ONLY.** Sirve como referencia funcional y visual. No se
modifica, no se le hacen commits, no se usa como entorno de prueba.

## Arranque

```bash
npm ci
cp .env.example .env    # completar si hace falta
npm run dev             # http://localhost:5173
```

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Typecheck + build de producción |
| `npm run preview` | Sirve el build en `/web-react/` |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript sin emitir |
| `npm test` | Vitest |

## Arquitectura

```
Componente  →  hook (useX)  →  service  →  Supabase  →  PostgreSQL
```

Los componentes **no** hablan con Supabase. Está verificado por ESLint: la
regla `no-restricted-imports` prohíbe importar el cliente fuera de
`services/`. No es una convención de buena voluntad; el lint falla.

```
src/
  app/          App, router, rutas, providers
  layouts/      AppLayout (shell) · AuthLayout
  modules/      un módulo de negocio por carpeta
  features/     transversales: auth, permisos, empresa, notificaciones…
  components/   ui · tables · forms · cards · modals · mobile
  services/     supabase (cliente único) · realtime · api
  hooks/ lib/ types/ utils/ styles/
```

Cada módulo tiene siempre la misma forma:
`pages/ · components/ · hooks/ · services/ · types/`.

Las decisiones y sus motivos están en
[`docs/architecture/`](docs/architecture/README.md).

## Convenciones

- **TypeScript estricto. Cero `any`** (`@typescript-eslint/no-explicit-any`
  en `error`). Si aparece una estructura legacy mal definida, primero se
  tipa con Zod en el borde.
- **Nada de polling global.** Ver [ADR-002](docs/architecture/ADR-002-query-cache.md).
- **Nada de `localStorage` como base de datos.** Sólo preferencias, tema y
  estado de UI no sensible.
- **Mobile-first**: la regla base es celular; `@media (min-width: …)` suma
  para pantallas grandes.
- **Cero `!important`.** Con CSS Modules no hacen falta (el legacy tiene 260).

## Testing

Fase 1 testea **lógica pura**, no cada `div`: validación de entorno,
derivación tabla→card, utilidades. 18 tests.

Los tests corren en entorno `node` porque todavía no hay componentes que
justifiquen un DOM. Cuando los haya (Fase 3), se suman `jsdom` y
`@testing-library/react`.

## Variables de entorno

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Ambas son **públicas por diseño**: viajan al navegador dentro del bundle.
La seguridad la da Row Level Security en Supabase, **no** el ocultamiento
de estas claves.

`src/lib/env.ts` las valida con Zod al arrancar: si faltan, la app falla
con un mensaje claro en vez de un 401 críptico.

## Seguridad — reglas del repositorio

El repositorio es **público**. Nada de lo siguiente entra acá, nunca:

- `service_role` o cualquier clave de servicio
- API keys privadas (OpenAI, Anthropic, etc.) — van en Edge Functions
- tokens administrativos, contraseñas, hashes
- datos reales de clientes
- dumps de producción
- archivos `.env`
- credenciales del sistema legacy

> La seguridad del frontend **no** puede depender de que el código sea
> privado. Ese fue el error del legacy, donde un token hardcodeado en el JS
> era todo lo que separaba a un visitante de la base entera.

Antes de cada push:

```bash
# En código: no debe haber ninguna coincidencia.
grep -rniE "service_role|sk-ant-|sk-[A-Za-z0-9]{20}|hnyngsejohkmlaccpkux" src/ *.ts *.json
# .env debe estar ignorado.
git check-ignore -v .env
```

## Deploy

Push a `main` → GitHub Actions corre `lint`, `typecheck`, `test`, `build` y
publica en GitHub Pages.

`VITE_BASE_PATH` se calcula con el **nombre real del repo**
(`github.event.repository.name`): renombrarlo no rompe el deploy.

**⚠ Pendiente de configuración:** el repositorio todavía tiene Pages en
`build_type: legacy` (Source: *Deploy from a branch*, `main /`). Hoy el sitio
sirve el artefacto del workflow igual, pero mientras la opción siga en
"branch" un build legacy puede volver a publicar la raíz del repo en vez del
`dist/`. Hay que cambiarlo a **Source: GitHub Actions** (requiere permiso de
administrador sobre el repo).

Requiere, una sola vez:

1. Settings → Pages → **Source: GitHub Actions**
2. Settings → Secrets and variables → Actions → `VITE_SUPABASE_URL` y
   `VITE_SUPABASE_ANON_KEY`

> GitHub Pages es el hosting **inicial**, no el definitivo. Antes de abrir
> el sistema a distribuidores o clientes se reevalúan hosting, dominio
> (`app.buscatools.com`) y visibilidad del repo.
