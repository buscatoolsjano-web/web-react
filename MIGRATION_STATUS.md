# Estado de la migración — BUSCATOOLS

Última actualización: **2026-09-08** · Fase actual: **2B Etapa 1 — Core + Catálogo + Stock + Precios (ejecutada y probada)**

**En línea:** https://buscatoolsjano-web.github.io/web-react/

## Leyenda

`—` no iniciado · `WIP` en progreso · `OK` terminado y verificado · `N/A` no aplica

## Estado por módulo

| Módulo | Estado | Legacy analizado | Schema DB | React UI | Funcional | Responsive | RLS | Tests | Aprobado |
|---|---|---|---|---|---|---|---|---|---|
| **Infraestructura (Fase 1)** | **OK** | OK | N/A | OK | OK | OK | N/A | OK | ⏳ |
| Auth / usuarios / permisos | WIP | OK | **Creado** | — | — | — | — | — | — |
| Multiempresa | WIP | OK | **Creado** | — | — | — | — | — | — |
| Catálogo | WIP | OK | **Creado** | — | — | — | — | — | — |
| Ventas | — | OK | Diseñado | — | — | — | — | — | — |
| Clientes | — | OK | Diseñado | — | — | — | — | — | — |
| Compras | — | OK | Diseñado | — | — | — | — | — | — |
| Mantenimiento | — | OK | Diseñado | — | — | — | — | — | — |
| WhatsApp | — | OK | Diseñado | — | — | — | — | — | — |
| Emails | — | OK | Diseñado | — | — | — | — | — | — |
| Informes / CRM | — | Parcial | — | — | — | — | — | — | — |
| Dashboard | — | Parcial | — | — | — | — | — | — | — |
| IA | — | Parcial | — | — | — | — | — | — | — |

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Auditoría del legacy | **OK** |
| 1 | Base React + CI/CD | **OK** — pendiente de aprobación |
| 2 | Diseño del schema Supabase | **PROPUESTA ENTREGADA** — pendiente de aprobación |
| 2B-1 | Core + Catálogo + Stock + Precios | **OK** — 15 tablas, 72/72 pruebas |
| 2.5 | Auth externo (cliente/distribuidor) + resto de RLS | Pendiente: 5 pruebas |
| 3 | Catálogo | — |
| 4 | Ventas + Clientes | — |
| 5 | Compras | — |
| 6 | Mantenimiento | — |
| 7 | WhatsApp | — |
| 8 | Emails + IA + PWA | — |

## Entregado en Fase 1

- Proyecto Vite + React 19 + TypeScript 5.9 estricto (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, cero `any`)
- HashRouter con code splitting por módulo (ADR-001)
- TanStack Query con defaults sin polling (ADR-002)
- Cliente Supabase único, con la regla "los componentes no lo importan" **verificada por ESLint** (ADR-003)
- Validación de entorno con Zod: falla al arrancar con mensaje accionable
- 27 design tokens portados literalmente del legacy, temas claro y oscuro (ADR-008)
- Shell mobile-first: sidebar drawer en celular, grilla en escritorio
- `ResponsiveTable`: tabla en escritorio, cards en celular, con escape hatch
- ESLint + Vitest (18 tests) + GitHub Actions con lint/typecheck/test antes del deploy
- 9 ADRs

## Referencia del legacy

Repositorio: `buscatoolsjano-web/Buscatools` — **READ ONLY**.
Se usa sólo como referencia funcional y visual. No se modifica.

Cifras medidas en la auditoría:

| Métrica | Valor |
|---|---|
| `app.js` | 5,33 MB · 45.345 líneas · ~2.100 funciones en un único scope global |
| `index.html` | 3,23 MB (incluye 1,95 MB de JSON embebido) |
| `productos-data.json` | **15,7 MB · 21.772 productos**, cargado con **XHR síncrono** que bloquea el arranque |
| Payload inicial | **≈ 24 MB** |
| Secciones | 19 |
| Claves de localStorage | 67 (33 sincronizadas a `erp_store`) |

## Fase 2 — entregado (2026-09-08)

Diseño completo del modelo de datos. **Nada ejecutado**: el proyecto
`uaxcfufvapzulqvynanp` sigue con el schema `public` vacío, `auth.users` en
0 filas y `storage.buckets` en 0.

| Documento | Contenido |
|---|---|
| [`PHASE_2_SCHEMA_DESIGN.md`](docs/database/PHASE_2_SCHEMA_DESIGN.md) | Documento principal, secciones A–Z |
| [`ERD_CORE`](docs/database/ERD_CORE.md) · [`ERD_CATALOG`](docs/database/ERD_CATALOG.md) · [`ERD_SALES`](docs/database/ERD_SALES.md) · [`ERD_PURCHASES`](docs/database/ERD_PURCHASES.md) · [`ERD_MAINTENANCE`](docs/database/ERD_MAINTENANCE.md) · [`ERD_COMMUNICATIONS`](docs/database/ERD_COMMUNICATIONS.md) | Diagramas ER en Mermaid |
| [`DATA_DICTIONARY.md`](docs/database/DATA_DICTIONARY.md) | Diccionario de datos |
| [`RLS_MATRIX.md`](docs/database/RLS_MATRIX.md) | Matriz de permisos por tabla y rol |
| [`MIGRATION_PLAN.md`](docs/database/MIGRATION_PLAN.md) | Plan de migración + dataset de prueba |
| [`DRAFT_SCHEMA.sql`](docs/database/DRAFT_SCHEMA.sql) | DDL propuesto — **DRAFT, NOT EXECUTED** |
| ADR-010 a ADR-014 | Decisiones estructurales |

**Propuesta:** 51 tablas en 7 dominios (58 en el borrador original, menos 7
eliminadas en la revisión de simplificación).

## Fase 2B · Etapa 1 — propuesta entregada (2026-09-08)

Core + Catálogo + Stock + Precios: **15 tablas**. **Nada ejecutado.**

| Documento | Contenido |
|---|---|
| [`PHASE_2B_STAGE_1.md`](docs/database/PHASE_2B_STAGE_1.md) | Revisión de simplificación, tablas, orden, dataset y 41 casos de prueba |
| [`STAGE_1_SCHEMA.sql`](docs/database/STAGE_1_SCHEMA.sql) | DDL + RLS + triggers + seeds *(desde entonces: **ejecutado**)* |
| [`scripts/sample-products.mjs`](scripts/sample-products.mjs) | Muestreo estratificado: 216 productos representativos |

Datos medidos en la auditoría del repo legacy real: 21.772 productos ·
988 clientes · 142 proveedores · 55 campos de producto · 378 productos con
stock · 5.456 sin marca · 12.588 en la categoría `otros`.

## Fase 2B · Etapa 1 — ejecutada (2026-09-08)

15 tablas creadas y probadas en uaxcfufvapzulqvynanp. **72/72 pruebas PASS.**

| Documento | Contenido |
|---|---|
| [STAGE_1_PRE_EXECUTION_STATE.md](docs/database/STAGE_1_PRE_EXECUTION_STATE.md) | Estado previo + validación estática |
| [STAGE_1_SCHEMA_VERIFICATION.md](docs/database/STAGE_1_SCHEMA_VERIFICATION.md) | Objetos creados, grants, RLS |
| [STAGE_1_TEST_RESULTS.md](docs/database/STAGE_1_TEST_RESULTS.md) | 72 pruebas + 6 problemas corregidos |
| [STAGE_1_SCHEMA.sql](docs/database/STAGE_1_SCHEMA.sql) | Referencia consolidada (ejecutada) |

Datos: 216 productos reales · 372 precios en 3 listas · 53 movimientos de
stock · 3 clientes de prueba · 5 usuarios con membresía. Base 10 MB → 13 MB.

## Próximo paso

**Etapa 1 pendiente de cierre:** faltan 5 pruebas de RLS que necesitan un
usuario con rol `customer` y otro con rol `distributor` en Supabase Auth.

Después, **Etapa 2 (Ventas)** — no empieza sin tu aprobación.
