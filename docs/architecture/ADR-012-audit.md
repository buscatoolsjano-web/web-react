# ADR-012 — Auditoría y trazabilidad

**Estado:** Propuesta · **Fecha:** 2026-09-08 · **Fase:** 2

## Contexto

El legacy tiene **tres sistemas de log conviviendo**:
`erp_trazabilidad_log`, `erp_activity_log` y `logAct()` por documento.
Registran navegación además de acciones de negocio, y **truncan
silenciosamente**: `m[k].slice(-500)` por documento y `k.splice(5000)` en
el kardex. Resultado: mucho volumen, poca información, y pérdida de datos
sin aviso.

## Decisión

**Una sola tabla**, `audit_events`, con **diff por campo** y **sólo
acciones de negocio**.

```sql
audit_events (
  id bigint identity, company_id, actor_id, entity_type, entity_id,
  entity_label,        -- 'PED00123', legible sin join
  action,              -- create|update|delete|status_change|approve|convert
  changes jsonb,       -- {"status": {"from": "pendiente", "to": "entregado"}}
  occurred_at
)
```

**Se audita:** documentos (alta, cambio, baja), cambios de estado,
aprobaciones, cambios de precio y de stock, altas y bajas de usuarios,
cambios de permisos, logins fallidos.

**No se audita:** navegación, apertura de pantallas, filtros, scroll,
lecturas.

Los campos auditados por entidad se declaran en una **lista blanca** en la
función de trigger.

## Alternativas

| Alternativa | Por qué no |
|---|---|
| `old_data` / `new_data` con la fila completa | KB por evento (un pedido con 50 líneas); hay que comparar a ojo para saber qué cambió |
| Sin auditoría | Un sistema multiusuario necesita saber quién hizo qué |
| Auditar todo, incluida navegación | Es exactamente lo que hace el legacy |
| Log externo (Datadog, etc.) | Dependencia y costo para algo que Postgres resuelve |

## Ventajas

- Legible directamente: se ve qué cambió sin diffear nada.
- Volumen estimado en unos pocos MB al año.
- `entity_label` evita un join para mostrar el historial.
- Escrito por triggers `SECURITY DEFINER`: **la aplicación no puede
  saltearlo ni falsificarlo**.

## Desventajas

- No permite reconstruir el estado completo en un momento dado.
- La lista blanca hay que mantenerla al agregar campos.

## Riesgo

Que la tabla crezca más de lo previsto.

**Mitigación:** `occurred_at` ya está pensada como clave de partición
(`PARTITION BY RANGE`). No hace falta particionar ahora.

## Impacto futuro

**Bajo.** Cambiar el formato de `changes` no rompe nada: los eventos
viejos siguen siendo legibles.

## Nota de seguridad

`audit_events` **no acepta `INSERT` desde el cliente** para ningún rol, ni
`UPDATE` ni `DELETE` para nadie, incluido `admin`. Un registro de auditoría
que el auditado puede borrar no sirve de nada.
