# ADR-010 — Modelo de datos relacional y multiempresa

**Estado:** Propuesta · pendiente de aprobación · **Fecha:** 2026-09-08 · **Fase:** 2

## Contexto

El legacy guarda todo el ERP como blobs JSON en `localStorage`,
espejados en una tabla `erp_store (key, value)`. Consecuencias medidas:

- **No hay claves foráneas.** `pedido.cliente` guarda el *nombre*
  (`"Nordex"`). Renombrar un cliente rompe su historial.
- **Las entregas parciales se indexan por posición de array**
  (`ped.entregado[idx]`). Reordenar una línea corrompe los datos.
- Sincronizar un cambio implica subir la colección entera.

## Decisión

Modelo relacional normalizado: **51 tablas en 7 dominios**, con FKs reales,
y `company_id uuid NOT NULL` en toda tabla de negocio.

**El aislamiento por empresa lo hace RLS, no el código de la aplicación**,
vía `app.current_company_ids()`.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| Mantener `erp_store` con JSONB | Es el problema, no la solución |
| Un proyecto Supabase por empresa | Infraestructura ×N; un usuario no podría operar en dos empresas |
| Un schema por empresa | Migraciones ×N; consultas entre empresas imposibles |
| Filtrar `company_id` en el frontend | Es el error del legacy (`_ekey()`): depende de que nadie se olvide |

## Ventajas

- Integridad garantizada por la base, no por convención.
- Consultas analíticas directas (habilita informes e IA sin tablas extra).
- Un `UPDATE` afecta una fila, no una colección.
- Aislamiento imposible de saltear, incluso manipulando la request.

## Desventajas

- Más tablas que mantener y migraciones más formales.
- El frontend necesita joins donde antes leía un objeto entero.

## Riesgo

Olvidar `company_id` o RLS en una tabla nueva la deja sin aislamiento.

**Mitigación:** test automatizado que recorra `information_schema` y falle
si una tabla de negocio no tiene `company_id` o tiene RLS deshabilitado.

## Impacto futuro

**Alto y difícil de revertir.** Es la decisión que sostiene todo el sistema
multiusuario y multiempresa. Cambiarla con datos cargados exigiría migrar
todo de nuevo.

Documentación completa: [`docs/database/PHASE_2_SCHEMA_DESIGN.md`](../database/PHASE_2_SCHEMA_DESIGN.md)
