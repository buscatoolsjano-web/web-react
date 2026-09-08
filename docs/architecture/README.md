# Decisiones de arquitectura (ADR)

Registro de las decisiones estructurales del proyecto y —sobre todo— de
**por qué** se tomaron.

Existe para que dentro de seis meses, en otra conversación o con otra
persona, nadie revierta una decisión sin conocer el motivo original.

| ADR | Tema | Estado |
|---|---|---|
| [001](ADR-001-router.md) | Router: HashRouter en GitHub Pages | Aceptada |
| [002](ADR-002-query-cache.md) | TanStack Query como capa de estado servidor | Aceptada |
| [003](ADR-003-supabase.md) | Cliente Supabase y capa de servicios | Aceptada |
| [004](ADR-004-auth-rls.md) | Supabase Auth y Row Level Security | Principios aceptados · diseño en Fase 2.5 |
| [005](ADR-005-multiempresa.md) | Arquitectura multiempresa | Principios aceptados · diseño en Fase 2 |
| [006](ADR-006-realtime.md) | Estrategia de Realtime | Aceptada · aplica en Fase 7 |
| [007](ADR-007-storage.md) | Archivos y Supabase Storage | Aceptada · aplica en Fase 3 |
| [008](ADR-008-estilos-responsive.md) | Estilos, tokens y responsive | Aceptada |
| [009](ADR-009-migracion-datos.md) | Qué datos se migran y cuáles no | Criterios aceptados |

## Cómo agregar una ADR

1. Numerar de forma correlativa.
2. Estructura: Contexto → Decisión → Consecuencias → Alternativas
   descartadas.
3. Escribir **por qué**, no sólo qué. El qué se lee en el código.
4. Una ADR no se edita cuando cambia de opinión: se marca como
   *Reemplazada por ADR-NNN* y se escribe la nueva.

## Decisiones pendientes

| Tema | Cuándo |
|---|---|
| Schema relacional completo | Fase 2 |
| Políticas RLS por rol | Fase 2.5 |
| Estrategia de PWA y service worker | Fase 8 |
| Hosting definitivo y dominio `app.buscatools.com` | Antes de abrir a usuarios externos |
| Repositorio público o privado | Antes de abrir a usuarios externos |
| Librería de formularios (¿`react-hook-form`?) | Fase 4 |
| Testing de componentes (jsdom + Testing Library) | Fase 3 |
