# Fase 10 · Informes — Entrega 1: actividad comercial

Fecha: **2026-09-13**. Base: Supabase `uaxcfufvapzulqvynanp`.

Primera pantalla de Informes del ERP nuevo: **cotizado, pedidos confirmados y
vendido (entregado)**, por moneda, mes actual contra mes anterior y serie de 12
meses. Todo lo agrega el servidor en una sola función de lectura.

SQL: [`docs/database/PHASE_10_INFORMES_ENTREGA_1.sql`](database/PHASE_10_INFORMES_ENTREGA_1.sql) ·
pruebas de base: `scripts/fase10-informes-entrega1-tests.mjs` ·
auditoría previa: [`PHASE_10_INFORMES_ENTREGA_0_AUDITORIA.md`](PHASE_10_INFORMES_ENTREGA_0_AUDITORIA.md).

---

## A · Decisiones de la entrega (del usuario)

| # | decisión |
|---|---|
| V1 | Informes v1: **ADMIN + EMPLOYEE** solamente |
| V2 | «Vendido» = **ENTREGADO** |
| — | **Pedidos** como KPI separado |
| — | **ARS / USD / EUR / SIN MONEDA** separados, **sin conversión** |
| V6 | Los 32 sin moneda se publican como **SIN MONEDA**; no se inventa moneda |
| — | Agregaciones **server-side** |
| — | Fuera de esta entrega: stock crítico, margen, cobranzas, vendedor, rubro |
| V8 | Archivos adjuntos **no** se migra como informe |

## B · Reglas de cálculo

| tema | regla | por qué |
|---|---|---|
| Vendido | remitos `deliveries.status in ('shipped','delivered')` | `confirmar_entrega` deja `shipped`; el histórico migrado está en `delivered`. Borrador y cancelado fuera |
| Pedidos | `sales_orders.commercial_status = 'confirmed'` | borrador y cancelado fuera |
| Cotizado | `sales_quotes.status <> 'draft'` (sent, accepted, **rejected, expired**) | lo cotizado es lo emitido, se haya ganado o no |
| Moneda | `currency_code` del documento; `NULL` → `'SIN MONEDA'` | sin conversión ni tipo de cambio (decisión R3/R4 de Ventas) |
| Importe | `total` del documento (con impuestos) | es el único total que existe en los tres documentos |
| Mes | **fecha del documento** (`quote_date`/`order_date`/`delivery_date`), mes calendario | `date` sin hora: el día 1 queda en su mes (bug 3 del legacy) |
| Hoy | `now()` en `America/Argentina/Buenos_Aires` | no depende del navegador |
| Comparación | mes en curso: **1 → hoy** contra **los mismos días** del mes anterior (acotado a su último día). Mes pasado: completo contra completo | el legacy comparaba un mes parcial con uno completo (bug 15) |
| Variación | `(actual − anterior) / anterior`; con anterior 0 → «sin base» | nunca +100 % inventado |
| Revisión | `needs_review` se cuenta por moneda y se avisa con enlace al listado filtrado | se muestran tal cual, no se corrigen |
| Serie | 12 meses que terminan en el mes elegido; meses vacíos en 0 | — |
| Mes futuro | rechazado (`mes_futuro`) | — |

**No hay un «total general».** Sumar ARS con USD sería inventar un número; cada
moneda tiene su fila y su escala.

## C · Permisos

- La función valida `app.current_role(p_company) in ('admin','employee')`
  **antes** de leer; si no, `sin_permiso` (`42501`). Es necesario porque la RLS
  de Ventas deja leer también a `salesperson` y `technician`.
- `SECURITY INVOKER`: además del chequeo de rol, la RLS de cada tabla sigue
  aplicando. No hay `SECURITY DEFINER` que saltee nada.
- `revoke all … from public, anon`; `grant execute … to authenticated`.
  ACL medida: `postgres`, `authenticated`, `service_role`. `search_path = public, pg_temp`.
- Frontend: `ROLES_INFORMES = ['admin','employee']` oculta el menú y la ruta
  muestra «Tu rol en esta empresa no tiene acceso a Informes.» — es comodidad;
  la barrera real es la función.
- `get_advisors` (security): la función no aparece; los hallazgos listados son
  previos a esta entrega.

## D · Contrato del RPC

```
informe_actividad_comercial(p_company uuid, p_mes date default null)
  → table (periodo, tipo, mes, desde, hasta, moneda, documentos, importe, en_revision)
```

- `p_mes` null = mes en curso; cualquier día del mes sirve (se trunca).
- Filas `rango_actual` y `rango_anterior`: **siempre**, con `desde`/`hasta` del tramo.
- Filas `mes`: serie, **dispersas** (un mes/moneda sin documentos no devuelve fila).
- Filas `actual` / `anterior`: por `tipo` y `moneda` en cada tramo.
- Errores: `sin_permiso` (42501), `mes_futuro` (22023).

El cliente (`armarActividad`) arma KPIs y series, completa ceros y ordena
monedas ARS, USD, EUR, otras alfabéticas, SIN MONEDA al final. Tipos en
`src/types/database.types.ts`.

## E · Qué se construyó

| capa | archivo |
|---|---|
| función | `public.informe_actividad_comercial` — migraciones `fase10_informes_entrega1_actividad` y `fase10_informes_entrega1_actividad_rangos` (definitiva) |
| servicio | `src/modules/informes/services/actividad.ts` — `obtenerActividad`, `ErrorInforme` con mensajes en castellano |
| hook | `src/modules/informes/hooks/useActividad.ts` — TanStack Query, `staleTime` 5 min, sin refetch al enfocar, no reintenta errores de permiso ni mes futuro |
| lógica pura | `src/modules/informes/lib/actividad.ts` (+ 13 tests), `lib/permisos.ts` |
| UI | `pages/InformesPage.tsx`, `components/TarjetaActividad.tsx`, `components/SerieMensual.tsx`, `components/Informes.module.css` |
| ruteo | `src/app/routes.tsx` (`/informes`, lazy), `src/layouts/AppLayout.tsx` (menú; sale de «Próximamente») |

Pantalla:

- selector de mes (`?mes=YYYY-MM` en la URL, tope = mes en curso), «Mes en curso», «Actualizar»;
- «Cómo se calcula» desplegable con las reglas de B;
- aviso de documentos en revisión con enlaces a `/ventas/{entregas|pedidos|cotizaciones}?revision=1&desde=&hasta=`;
- tres tarjetas (Vendido, Pedidos, Cotizado): fila por moneda con importe y
  cantidad del tramo actual y del anterior, variación; SIN MONEDA resaltada;
- serie de 12 meses: tipo de documento + una moneda a la vez, barras decorativas
  y el valor escrito al lado.

## F · Pruebas

### Base — `scripts/fase10-informes-entrega1-tests.mjs`

JWT reales; fixtures en empresas `zz-inf1-*` con fechas relativas a hoy en
Argentina; expectativas calculadas **en JS con las mismas reglas**, sin reusar
el SQL; importes comparados a 4 decimales (los de la base).

Corrida del 2026-09-13: **30 PASS · 0 fallos.**

| sección | resultado |
|---|---|
| 1 · fixtures | 22 documentos · 2 empresas · 7 identidades |
| 2 · quién puede | admin y employee leen; salesperson, technician, customer, distributor, admin de otra empresa y empresa nula → `sin_permiso`; anon → `42501` |
| 3 · mes en curso | filas **exactas** contra la regla; tramos 1–13 sep vs 1–13 ago; el día 1 en su mes; SIN MONEDA aparte con su revisión; ARS sin mezclar; borradores/cancelados fuera; `shipped` cuenta; empresa ajena, mañana y fuera de 12 meses no entran; el primer mes de la serie sí |
| 4 · mes pasado y futuro | agosto completo vs julio completo, filas exactas; mes futuro → `mes_futuro` |
| 5 · paridad Buscatools | **73 filas = suma directa sobre las tablas**; septiembre, entregas SIN MONEDA = 15 docs · 12.996.570,72 · 15 en revisión |
| 6 · limpieza | 0 empresas y 0 usuarios `zz-inf1` |

Latencia del RPC (5 llamadas, con red, 75 filas, 11.478 B): corrida anterior
mediana **217 ms** / máx 242 ms; esta corrida mediana **191 ms** / máx 1.199 ms
(la primera llamada, en frío). Criterio: mediana < 1,5 s.

### Frontend

`lib/actividad.test.ts`: 13 tests (orden de monedas, cifras por moneda,
variación sin base, serie con ceros, tramo parcial, lectura de `?mes`, etiquetas,
permisos). Los chequeos completos del repo están en I.

### Verificación en navegador (sesión real, Buscatools)

| qué | medido |
|---|---|
| Vendido sep 2026 (1–13) | ARS 1.000.265,03 (2) · USD 1.300,01 (2) · SIN MONEDA 12.996.570,72 (15) |
| Vendido may 2026 | USD 62.324,28 — igual al valor corregido de la auditoría |
| Cotizado jul / ago 2026 | USD 143.747,01 / 130.031,87 |
| `?mes` futuro | «Ese mes todavía no empezó.», sin «Reintentar» |
| `?mes` inválido | cae al mes en curso |
| enlace de revisión | `#/ventas/entregas?revision=1&desde=2026-09-01&hasta=2026-09-13` → «1–19 de 19» |
| responsive 390 / 430 / 520 / 768 / 1440 px | sin desborde horizontal de página; controles ≥ 44 px y campos 16 px con puntero táctil; tabla en bloques ≤ 599 px; importes nunca cortados |
| consola | sin errores |

## G · Legacy vs ERP nuevo — septiembre 2026

| KPI | legacy | ERP nuevo |
|---|---|---|
| Vendido | **USD 12.996.570,72** (15 NE sin moneda contadas como USD; ARS excluido) | USD 1.300,01 · ARS 1.000.265,03 · **SIN MONEDA 12.996.570,72**, marcado para revisión |
| Documentos del día 1 | caían en el mes anterior | en su mes |
| Comparación del mes en curso | parcial vs mes completo | mismos días |
| «Vendido» | NE en Informes, pedidos en Inicio | entregado, y pedidos aparte con su nombre |

Los bugs 1, 2, 3, 15 y 17 de la auditoría quedan corregidos para estos KPIs.

## H · Limitaciones y decisiones pendientes (NON-BLOCKING)

1. **Stock crítico** (V3): no se muestra; falta definir mínimo por producto.
2. **Outlier GRAMPA.80-4T** (V4): no afecta esta entrega (no hay rankings por
   unidades); se decide para la Entrega 3.
3. **Costo y margen** (V5): no hay costo en el ERP nuevo; sin margen ni valorización.
4. **Los 32 documentos sin moneda** (V6): se publican como SIN MONEDA con aviso
   y enlace; nadie los corrigió todavía. Mientras sigan así, septiembre muestra
   12,99 M en esa fila.
5. **Facturación y cobranzas** (V7): no existen; sin «facturado», «por cobrar» ni aging.
6. **Archivos adjuntos** (V8): no se migra como informe.
7. Sin vendedor ni rubro (`salesperson_id`/`created_by` vacíos en el histórico).
8. Sin exportación CSV en esta entrega (plan: Entrega 3, con moneda).
9. La serie muestra una moneda por vez; no hay gráfico combinado a propósito.
10. Informes lee la empresa activa; no hay vista «todas las empresas».

## I · Chequeos

Corridos el 2026-09-13, antes del commit:

| chequeo | resultado |
|---|---|
| `npm run lint` | 0 errores |
| `npm run typecheck` | 0 errores |
| `npm test` | 52 archivos · **618 tests** PASS |
| `npm run test:isolated` | 52 archivos · **618 tests** PASS |
| `npm run build` | OK · `InformesPage` 13,14 kB JS (4,62 kB gzip) + 7,03 kB CSS, chunk propio |
| suite de base E1 | 30 PASS · 0 fallos |

Backend de Emails sin cambios: no se re-corrió. Otras suites de base no se
re-corrieron: el único cambio de base es una función nueva de sólo lectura, sin
tablas, RLS ni grants sobre objetos existentes.
