# Estado de la migración — BUSCATOOLS

Última actualización: **2026-09-08** · Fase actual: **1 — Base React (completada)**

## Leyenda

`—` no iniciado · `WIP` en progreso · `OK` terminado y verificado · `N/A` no aplica

## Estado por módulo

| Módulo | Estado | Legacy analizado | Schema DB | React UI | Funcional | Responsive | RLS | Tests | Aprobado |
|---|---|---|---|---|---|---|---|---|---|
| **Infraestructura (Fase 1)** | **OK** | OK | N/A | OK | OK | OK | N/A | OK | ⏳ |
| Auth / usuarios / permisos | — | OK | — | — | — | — | — | — | — |
| Multiempresa | — | OK | — | — | — | — | — | — | — |
| Catálogo | — | OK | — | — | — | — | — | — | — |
| Ventas | — | OK | — | — | — | — | — | — | — |
| Clientes | — | OK | — | — | — | — | — | — | — |
| Compras | — | OK | — | — | — | — | — | — | — |
| Mantenimiento | — | OK | — | — | — | — | — | — | — |
| WhatsApp | — | OK | — | — | — | — | — | — | — |
| Emails | — | OK | — | — | — | — | — | — | — |
| Informes / CRM | — | Parcial | — | — | — | — | — | — | — |
| Dashboard | — | Parcial | — | — | — | — | — | — | — |
| IA | — | Parcial | — | — | — | — | — | — | — |

## Fases

| Fase | Contenido | Estado |
|---|---|---|
| 0 | Auditoría del legacy | **OK** |
| 1 | Base React + CI/CD | **OK** — pendiente de aprobación |
| 2 | Diseño del schema Supabase | — |
| 2.5 | Auth + multiempresa + roles + RLS | — |
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

## Próximo paso

**Fase 2** — diseñar el schema relacional. No empieza sin aprobación
explícita de la Fase 1.
