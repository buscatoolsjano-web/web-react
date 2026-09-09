# Estado de la migración — BUSCATOOLS

Última actualización: **2026-09-09** · Fase actual: **3 — Catálogo en React** · implementado y probado con sesiones reales · **116/116**

**En línea:** https://buscatoolsjano-web.github.io/web-react/

> **🔴 RIESGO DE SEGURIDAD ABIERTO — prioridad ALTA.** El legacy y React
> comparten origen (`buscatoolsjano-web.github.io`) y por lo tanto
> `localStorage`: el legacy puede leer `bt-auth`, el token de sesión de
> Supabase. **Mover React a `app.buscatools.com` es requisito antes de
> abrir el sistema a distribuidores, clientes o usuarios externos.**
> Ver [SHARED_ORIGIN_RISK.md](docs/security/SHARED_ORIGIN_RISK.md).

## Leyenda

`—` no iniciado · `WIP` en progreso · `OK` terminado y verificado · `N/A` no aplica

## Estado por módulo

| Módulo | Estado | Legacy analizado | Schema DB | React UI | Funcional | Responsive | RLS | Tests | Aprobado |
|---|---|---|---|---|---|---|---|---|---|
| **Infraestructura (Fase 1)** | **OK** | OK | N/A | OK | OK | OK | N/A | OK | ⏳ |
| Auth / usuarios / permisos | **OK** | OK | **Creado** | **Hecho** | **Hecho** | **Hecho** | **Probado** | 51 | ⏳ |
| Multiempresa | **OK** | OK | **Creado** | **Hecho** | **Hecho** | **Hecho** | **Probado** | 14 | ⏳ |
| Catálogo | **OK** | OK | **Creado** | **Hecho** | **Hecho** | **Hecho** | **Probado** | 116 | ⏳ |
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
| 2B-1 | Core + Catálogo + Stock + Precios | **CERRADA** — 15 tablas, **121/121 PASS** |
| 2.5 | Auth + multiempresa + RLS por rol | **OK** — 7 usuarios, 8 membresías, roles internos y externos probados |
| 3 | Catálogo | **ENTREGADA** — 116/116 pruebas · 6 bugs encontrados y corregidos · pendiente de aprobación |
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

15 tablas creadas y probadas en uaxcfufvapzulqvynanp.

# TOTAL TESTS: 121 · PASS: 121 · FAIL: 0

| Documento | Contenido |
|---|---|
| [STAGE_1_PRE_EXECUTION_STATE.md](docs/database/STAGE_1_PRE_EXECUTION_STATE.md) | Estado previo + validación estática |
| [STAGE_1_SCHEMA_VERIFICATION.md](docs/database/STAGE_1_SCHEMA_VERIFICATION.md) | Objetos creados, grants, RLS |
| [STAGE_1_TEST_RESULTS.md](docs/database/STAGE_1_TEST_RESULTS.md) | 121 pruebas + 8 problemas corregidos |
| [STAGE_1_SCHEMA.sql](docs/database/STAGE_1_SCHEMA.sql) | Referencia consolidada (ejecutada) |

Datos: **219 productos** (216 Buscatools + 3 Torquetools) · 375 precios ·
53 movimientos de stock · 3 clientes · **7 usuarios, 7 profiles, 8 membresías**.
Base 10.203 kB → 13 MB.

Multiempresa verificado en vivo: **Jano tiene un solo profile y dos
membresías** — admin en Buscatools, salesperson en Torquetools. Ser admin
en una empresa no le da permisos en la otra, y poner el company_id de la
otra empresa en un INSERT no eleva sus permisos.

Ocho problemas encontrados y corregidos, dos de ellos críticos: el RELEASE
de reservas estaba roto y la vista de disponibilidad no servía a los
usuarios externos. Ambos habrían llegado a producción.

## Próximo paso

**Etapa 1 CERRADA.** **Fase 3 implementada** — ver [PHASE_3_CATALOG_DESIGN.md](docs/PHASE_3_CATALOG_DESIGN.md) y [PHASE_3_TEST_RESULTS.md](docs/PHASE_3_TEST_RESULTS.md).

Pendiente de tu decisión: la relación N:N atributo↔categoría
([evidencia](docs/database/ATTRIBUTE_CATEGORY_RELATION.md)) y las credenciales
de prueba para cerrar las 9 pruebas de RLS desde el navegador.

Próximo: **Etapa 2 (Ventas)** — no empieza sin tu aprobación.
Tampoco se cargan los 21.772 productos todavía.

## Fase 3 · Catálogo — entregada (2026-09-09)

# TOTAL TESTS: 116 · PASS: 116 · FAIL: 0

Auth real con Supabase Auth, empresa activa desde membresías reales y
catálogo con paginado y búsqueda server-side. Probado en producción con
**5 roles** y sesiones reales.

| Documento | Contenido |
|---|---|
| [PHASE_3_CATALOG_DESIGN.md](docs/PHASE_3_CATALOG_DESIGN.md) | Diseño, secciones A–J |
| [PHASE_3_TEST_RESULTS.md](docs/PHASE_3_TEST_RESULTS.md) | Las 116 pruebas y los 6 bugs |
| [PHASE_3_RLS_CHECKLIST.md](docs/PHASE_3_RLS_CHECKLIST.md) | Guion de pruebas por rol |
| [SHARED_ORIGIN_RISK.md](docs/security/SHARED_ORIGIN_RISK.md) | **Riesgo de seguridad abierto** |
| [ATTRIBUTE_CATEGORY_RELATION.md](docs/database/ATTRIBUTE_CATEGORY_RELATION.md) | Evidencia de la relación N:N — **sin ejecutar** |

**Seis bugs encontrados, todos corregidos.** Ninguno los detectaron los 48
tests unitarios: los seis aparecieron probando con sesión real contra el
deploy.

| Métrica | Legacy | React |
|---|---|---|
| Bytes de datos en la primera carga | **15,7 MB** | **28,2 KB** — 570× menos |
| Requests bloqueantes | 1 XHR síncrono | 0 |
| Productos en memoria | 21.772 | 50 |
| Bundle inicial (gzip) | — | 183 KB |
| El precio lo decide | `pu * 3` en JavaScript | RLS en PostgreSQL |
| El costo viaja al navegador | Sí, oculto con CSS | **La columna no existe** |
