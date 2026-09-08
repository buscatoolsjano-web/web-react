# ADR-009 — Qué datos se migran y cuáles no

**Estado:** Aceptada (criterios) · Ejecución por módulo desde Fase 3
**Fecha:** 2026-09-08

## Contexto

El proyecto Supabase nuevo (`uaxcfufvapzulqvynanp`) arranca **vacío**:
verificado en Fase 1 — cero tablas en `public`, cero usuarios, cero
buckets.

Es una oportunidad que no se repite: **todo lo que entre, entra limpio**.

## Decisión

### Regla general

> Primero el schema nuevo. Después, sólo los datos útiles.

Nada se copia "porque estaba".

### NO se migra

| Qué | Por qué |
|---|---|
| `erp_store` completo | Es el blob JSON que estamos eliminando por diseño |
| Hashes de contraseñas (`erp_auth_users`) | SHA-256 sin salt. Los usuarios se recrean con Supabase Auth |
| Usuarios legacy | Se recrean con identidades reales |
| `erp_trazabilidad_log`, `erp_activity_log` | Logs de navegación, sin valor de negocio |
| Tablas creadas por bugs | — |
| Secretos, tokens, API keys | Nunca. Ver ADR-004 |
| Metadatos de importación | `_importOrigen` (58% de los productos), `_apexPageCatalog`, `_apexFamilyTitle`, `_apexEnriquecido` (17%): son rastros del proceso de importación, no datos de negocio |
| Deltas de stock en localStorage | El stock se modela como movimientos. Ver abajo |

### SÍ se migra, con revisión de calidad

| Qué | Volumen medido | Observaciones |
|---|---|---|
| Productos | **21.772** (`productos-data.json`, 15,7 MB) | Ver análisis abajo |
| Clientes | 988 | Revisar duplicados y normalización |
| Proveedores | 142 | — |
| Documentos comerciales | A medir en Fase 4 | Sólo los vigentes + histórico acordado |
| Fichas de mantenimiento | A medir en Fase 6 | — |

### Análisis del catálogo (medido en la auditoría)

De 54 campos distintos en los 21.772 productos:

- **12 están presentes al 100%**: `sku`, `base`, `nombre`, `marca`, `cat`,
  `tipo`, `encastre`, `desc`, `imgs`, `s`, `peso_g`, `volumen_cm3`.
- **42 aparecen en menos del 10%**: `rpm`, `torq_min`, `torq_max`,
  `carcasa`, `voltaje`, `eslinga`, `min_kg`/`max_kg`…

**Implicación de diseño:** columnas tipadas para el núcleo + una columna
`attributes jsonb` para la cola larga específica por marca. Modelar 54
columnas donde 42 están casi siempre vacías sería un error.

**Otros hallazgos que condicionan el schema:**

- Categorización pobre: **12.588 de 21.772 productos están en `otros`**.
  Hay que revisar la taxonomía antes de migrar, no después.
- 25 marcas. Las 4 primeras (SPEEDRILL, APEX, FIAM, TOHNICHI) concentran
  14.845 productos.
- Precios inconsistentes: `pu` (precio unitario USD) está en el 77%;
  `costo` y `precio_venta` en ~1%.
- `sr` (stock real) y `sv` (stock virtual) se ajustan con *deltas* en
  localStorage. **En el modelo nuevo el stock es una tabla de movimientos**
  y el saldo se deriva; nunca un número que se pisa.

### Procedimiento por módulo

1. Diseñar y aprobar el schema.
2. Escribir un script de migración **idempotente**.
3. Correrlo primero contra un branch de Supabase, nunca directo.
4. Validar: totales, muestreo manual, integridad referencial.
5. Recién entonces, producción.

## Consecuencias

- La base nueva arranca sin la deuda de la vieja.
- Costo: migrar lleva más trabajo que un `COPY`. Es el punto.
