# Fase 17 · Clientes · Entrega 1 — Edición segura, concurrencia y auditoría

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: `docs/database/PHASE_17_CLIENTES_ENTREGA_1.sql` (migraciones
`phase17_clientes_entrega_1_diff_y_auditoria` y `…_guardar_cliente`), con ROLLBACK.

E1 lleva la edición del cliente al mismo estándar que Cotización, Pedido y Remito: **una RPC
atómica, concurrencia optimista, aviso al salir con cambios y auditoría del antes y el después**.
No se rehizo la ficha ni se rediseñó nada: se cambió el camino de escritura y se sumaron los dos
campos comerciales que ya decidiste.

No se tocó Ventas, WhatsApp, STEL, contactos ni direcciones.

---

## 1 · Precheck

| Clave | Cómo estaba |
|---|---|
| CURRENT_SAVE_PATH | «Editar» reemplazaba la vista de lectura **dentro de la pestaña «Datos comerciales»** por un formulario con borrador local y **Guardar cambios / Cancelar**. Confirmado: **no hay ni un `onBlur`** en todo el módulo, no se guardaba campo por campo. |
| CURRENT_WRITERS | `actualizarCliente()` hacía `update` directo sobre `customers` filtrando por `company_id` + `id`, con 11 columnas. Además, escrituras directas para la baja lógica (`deleted_at` + `status`) y la reactivación, y una RPC ya existente para resolver la cola de revisión. |
| CURRENT_UPDATED_AT | La columna existe y un trigger (`app.touch_updated_at`) la mueve en cada update, **pero nadie la leía ni la comparaba**: la ficha ni siquiera la traía. Gana el último que guarda. |
| AUDIT_REUSE_POSSIBLE | **Sí.** `sales_audit` es genérica (`entity_type`, `entity_id`, `action`, `from_status`, `to_status`, `diff`, `actor_id`) y **no tiene CHECK sobre `entity_type`**: acepta `customer` sin migración. No se creó ninguna tabla nueva. |

Tres invariantes que ya existían y que E1 respeta en vez de pelear: el trigger que le pone el
vendedor al cliente que crea un vendedor (y que en UPDATE se lo devuelve), el que recalcula los
motivos de revisión, y el que impide borrar un cliente con documentos.

## 2 · `guardar_cliente`

```
guardar_cliente(p_customer uuid, p_esperado timestamptz, p_datos jsonb) → jsonb
```

En una transacción: bloquea la fila (`for update`), valida el actor contra el mismo criterio que la
policy `customers_update` —admin y employee cualquiera, `salesperson` sólo los suyos—, rechaza el
cliente dado de baja, compara el testigo, valida la whitelist, valida las FK comerciales, escribe
**una sola vez** y deja **un solo evento** de auditoría. Devuelve el testigo nuevo y cuántos campos
cambiaron.

`SECURITY DEFINER` con `search_path` fijo, `revoke … from public, anon`, `grant` a `authenticated` y
`service_role`, y la autorización comprobada adentro (porque el definer saltea RLS).

## 3 · Whitelist

Editables: `legal_name`, `trade_name`, `tax_id`, `emails`, `email_domains`, `industry`, `phone`,
`customer_type`, `payment_terms`, `default_currency`, `notes`, **`salesperson_id`** y
**`default_price_list_id`**.

Cualquier otra clave corta con `CAMPO_NO_EDITABLE`, **no se filtra en silencio**. Probado uno por uno:
`id`, `company_id`, `created_at`, `updated_at`, `created_by`, `imported_at`, `legacy_source`,
`legacy_ref`, `needs_review`, `review_reason`, `deleted_at`, `status`, `discount_pct` y
`credit_limit`.

`discount_pct` y `credit_limit` quedaron **afuera a propósito**: no están en el formulario, no hay
regla de negocio escrita que los use y en producción están vacíos en los 1.010 clientes. Agregarlos
a la whitelist sin pantalla sería superficie muerta.

## 4 · Concurrencia

Mismo modelo que Ventas: si `updated_at` no coincide con el testigo, `CONFLICTO_DE_EDICION` **sin**
errcode `40001` —con ése PostgREST reintenta solo y el usuario ve un timeout en vez del aviso—.

Verificado con dos actores reales: A guarda el teléfono, B intenta guardar las notas con la versión
vieja, **B recibe el conflicto y lo de A queda intacto**. Y dos guardados simultáneos: gana uno solo.

En la pantalla, el conflicto es un aviso propio con botón **Recargar** y el texto «lo que escribiste
sigue en pantalla»: el borrador **no se toca**.

## 5 · Vendedor, tarifa y CUIT

- **Vendedor** (decisión 1): lo editan admin y employee. Se valida que sea miembro **activo de la
  misma empresa** con rol que vende. Un `salesperson` que intente reasignar su propio cliente recibe
  `VENDEDOR_NO_EDITABLE` en vez de que el cambio se ignore en silencio, que es lo que pasaba antes.
- **Tarifa** (decisión 2): editable y validada contra las listas de la empresa. **No sugiere nada al
  crear documentos todavía** —eso es E2— y la pantalla lo dice: *«Queda registrada en el cliente.
  Todavía no cambia los precios de los documentos.»*
- **CUIT** (decisión 5): **no es obligatorio**. Si se informa, tiene que tener 11 dígitos y ser único
  por empresa (índice normalizado que ya existía). Se valida **sólo si cambió**: un cliente viejo con
  un CUIT de formato raro se puede seguir editando en cualquier otro campo. Sin backfill.

## 6 · Aviso al salir y descarte

`useSalidaConCambios` + `DialogoCambiosSinGuardar`, los mismos de Ventas: cubre menú, breadcrumb,
otra ruta, atrás/adelante y cerrar la pestaña. **Cambiar de pestaña dentro de la ficha no pregunta**,
porque no navega. «Cancelar» con cambios pide confirmación; sin cambios cierra derecho.

El formulario le avisa a la ficha si está sucio **desde un efecto**, no durante el render: la primera
versión lo hacía en el render y React lo marcó por consola. Corregido y verificado en el navegador
con la consola instrumentada (0 avisos).

## 7 · Guardar sin cambios

Dos cinturones:

1. **La pantalla no llama**: «Guardar cambios» está deshabilitado mientras el borrador sea igual al
   original (verificado en producción: al abrir la edición arranca apagado).
2. **El servidor no inventa**: si el diff queda vacío, contesta `sin_cambios`, **no toca
   `updated_at`** y **no escribe auditoría**.

## 8 · Auditoría

| Evento | Quién lo escribe | Qué guarda |
|---|---|---|
| `updated` | `guardar_cliente` | sólo los campos que cambiaron, con `from` y `to` |
| `created` | trigger de alta | referencia y razón social |
| `deactivated` / `reactivated` | trigger de estado | el cambio de `deleted_at` y de `status` |

Todo en `sales_audit` con `entity_type = 'customer'`. **Las lecturas no se auditan.** Los dos
triggers se saltean cuando no hay usuario: una importación o una migración no se registra como si
fuera una persona (probado).

La **pestaña Trazabilidad no se construyó**: E1 sólo genera los datos correctos. Media pantalla de
timeline es peor que ninguna.

## 9 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase17-e1-clientes-tests.mjs` (base real, empresas de fixture) | **63 PASS · 0 fallos** |
| `npm test` / `npm run test:isolated` | 1448 tests, 126 archivos |
| `npm run lint`, `npx tsc -b`, `npm run build` | limpio |

Del corrido de la base: `normaliza los emails: minúscula, sin vacíos y sin repetidos`;
`el testigo nuevo es el que devolvió la RPC`; 14 × `inyectar <campo> — CAMPO_NO_EDITABLE` y
`ningún intento cambió nada`; `el segundo recibe CONFLICTO_DE_EDICION` con `lo de A quedó` y
`lo de B NO pisó nada`; `contesta «sin cambios»`, `no movió el testigo`, `no inventó un evento`;
`tres campos en UN solo evento` y `sólo los campos que cambiaron`; `un CUIT de 8 dígitos —
CUIT_INVALIDO`; `un CUIT viejo raro no bloquea editar otro campo`; `un vendedor de otra empresa —
VENDEDOR_INVALIDO`; `el vendedor sí edita el suyo` pero `no se reasigna el cliente`;
`una importación NO se audita como si fuera una persona`; `producción idéntica al baseline`.

Frontend: 12 pruebas nuevas en `ClienteDetallePage.test.tsx` (guardado con testigo, vendedor y
tarifa, botón apagado sin cambios, cancelar con y sin cambios, cambiar de pestaña, salir con
cambios, conflicto que conserva el borrador). El archivo se migró a un **data router** real, porque
`useBlocker` no existe en `MemoryRouter`.

## 10 · Verificación en el navegador

Sobre datos reales, **sin guardar nada**: la ficha abre, «Editar» muestra los dos campos nuevos con
las opciones reales de la empresa, «Guardar cambios» arranca deshabilitado, al escribir se habilita,
y salir hacia el listado muestra «Hay cambios sin guardar» con «Seguir editando» y «Descartar y
salir». Se descartó. Sin desborde horizontal a 375 ni a 1024 px. Consola instrumentada: sin avisos.

## 11 · Qué falta para E2 (`E2_GAPS`)

- **Conectar los defaults con Ventas**: que la tarifa, el vendedor, la condición de pago y la moneda
  del cliente **sugieran** al crear cotización y pedido, sin tocar documentos existentes.
- **Contactos y direcciones** (E3): principal atómico, permisos del vendedor (decisión 3), dirección
  de entrega explícita en el pedido (decisión 4) y desactivar en vez de borrar.
- **Pestaña Trazabilidad** (E4): ya hay datos que mostrar.
- **Alta**: sigue siendo un insert desde el navegador. Queda auditada por trigger, pero no es
  atómica con su contacto/dirección. Cuando E3 defina el alta con contacto, conviene una
  `crear_cliente` gemela.
- `discount_pct` y `credit_limit` siguen sin pantalla: decisión pendiente (§ 11 de E0).
