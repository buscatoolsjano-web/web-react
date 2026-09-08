# ADR-003 — Cliente Supabase y capa de servicios

**Estado:** Aceptada · **Fecha:** 2026-09-08 · **Fase:** 1

## Contexto

El sistema legacy no usa el SDK de Supabase: hace `fetch` crudo contra la
API REST, con las cabeceras repetidas en cada punto de llamada, y con un
WebSocket Phoenix implementado a mano (reconexión y heartbeat incluidos).
Las llamadas a datos están desparramadas por todo `app.js`, lo que hace
imposible cambiar el acceso a datos sin tocar la UI.

## Decisión

### 1. Un solo cliente

`src/services/supabase/client.ts` es la **única** llamada a `createClient()`
del proyecto.

### 2. Los componentes no hablan con Supabase

```
Componente  →  hook (useX)  →  service  →  supabase
```

Está **verificado por ESLint**: la regla `no-restricted-imports` prohíbe
importar el cliente fuera de `services/` y `features/auth/`. No es una
convención que se respeta por disciplina; el lint falla.

### 3. Proyecto nuevo, aislado

La app se conecta **exclusivamente** al proyecto `uaxcfufvapzulqvynanp`.
El proyecto legacy (`hnyngsejohkmlaccpkux`) no aparece en ningún archivo de
código ni de configuración — sólo se lo menciona en documentación, para
dejar constancia de cuál **no** hay que usar. El checklist de validación lo
verifica antes de cada push.

### 4. Clave publishable, no la anon JWT legacy

Usamos `sb_publishable_...` en vez de la anon JWT. Se puede rotar de forma
independiente sin invalidar sesiones. Ambas son públicas por diseño.

### 5. Tipos generados (desde Fase 2)

Cuando exista el schema, `supabase gen types` genera
`src/types/database.types.ts` y el cliente pasa a `createClient<Database>`.
Escribir un nombre de columna mal pasa a ser un error de compilación.

## Consecuencias

- Cambiar de backend, o cómo se consulta, toca **solo** `services/`.
- Los services son testeables con mocks.
- Costo: una capa de indirección más. Aceptado: es la que evita que 200
  componentes conozcan el esquema de la base.
