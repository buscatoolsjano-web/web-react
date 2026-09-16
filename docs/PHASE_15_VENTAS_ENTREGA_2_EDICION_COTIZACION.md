# FASE 15 · VENTAS — ENTREGA 2: EDICIÓN DE LA COTIZACIÓN

> Cambia el **modelo de guardado**: editar arma un borrador en memoria y nada se escribe
> hasta apretar «Guardar cambios». Una migración (`sales_quotes.price_list_id` +
> `public.guardar_cotizacion`). Sólo Cotización: Pedido y Remito quedan como estaban.
> No toca autoridad de numeración, secuencias, cutover, STEL, stock, precios de catálogo,
> policies ni RLS. 2026-09-16.

---

## 1. Antes y después

### Antes (E1)

Cada campo se escribía solo al perder el foco. Tocar el título era un `update`; corregir una
cantidad, otro; equivocarse y volver atrás, un tercero. Consecuencias:

- **No había «Descartar» posible.** Lo escrito ya estaba en la base. E1 se negó explícitamente
  a mostrar el botón porque habría sido mentir.
- **El documento quedaba a medias** si algo fallaba en el medio: cinco campos guardados, el
  sexto rechazado y ninguna forma de saber en qué estado quedó.
- **La auditoría no contaba la historia.** Los eventos de `sales_audit` los escribían los
  triggers de línea; los cambios de cabecera no dejaban rastro.
- **Dos personas editando a la vez se pisaban** sin enterarse: gana el último `blur`.

### Después (E2)

```
Editar ──► borrador en memoria (cabecera + líneas + orden)
             │
             ├── cambiar lo que sea  → NADA se escribe
             ├── cambiar de pestaña  → el borrador sigue vivo
             ├── Descartar           → confirmación y se suelta el borrador
             └── Guardar cambios     → UNA llamada, UNA transacción
```

Un único camino de escritura: `guardarCotizacion(...)` → `public.guardar_cotizacion(...)`.
Entra todo junto —cabecera, líneas, borrados y el evento de auditoría— o no entra nada.

---

## 2. Semántica de guardado

| Situación | Qué pasa |
| --- | --- |
| Entrar en edición | Se toma un **snapshot** (`original`) y se clona en `borrador`. Se guarda además `updated_at` como testigo de concurrencia. |
| Editar cualquier campo | Sólo cambia `borrador`. Cero llamadas a la base. |
| Sin cambios | «Guardar cambios» está deshabilitado y el aviso dice «Sin cambios todavía. Lo que edites no se escribe hasta que lo guardes». |
| Con cambios | El aviso pasa a «Hay cambios sin guardar. No se escribe nada hasta que aprietes «Guardar cambios»». |
| Cambiar de pestaña | El borrador **no** se pierde: las cinco pestañas comparten el mismo estado. |
| Descartar con cambios | `ConfirmDialog` «Hay cambios sin guardar» (nunca `window.confirm`). Al confirmar se suelta el borrador y vuelve lo del servidor. |
| Descartar sin cambios | Sale de edición sin preguntar: no hay nada que perder. |
| Cerrar la pestaña con cambios | `beforeunload` sólo mientras hay cambios sucios; un aviso permanente es ruido que se aprende a ignorar. |
| Guardar OK | Se limpia el borrador, se refresca el documento, se invalida la trazabilidad y aparece «Cambios guardados». |
| Guardar con error | **El borrador no se toca**: lo escrito sigue en pantalla, con el motivo en castellano. |

Mientras se edita, las acciones del documento (duplicar, cancelar, generar pedido) no se ofrecen:
ejecutarlas con un borrador a medias sería perderlo.

El estado «sucio» se calcula comparando borrador contra snapshot (`hayCambios`), no con un flag:
escribir y volver a escribir el valor original deja el documento limpio otra vez.

Editabilidad: **no se amplió**. Sigue decidiéndola `editabilidad(estado, escribe)` — el mismo
criterio de E1: estados `draft` y `sent`, roles `admin` y `employee`. La RPC revalida los dos del
lado del servidor, con la misma matriz que `quotes_write` y que `escribeVentas`.

---

## 3. La RPC `public.guardar_cotizacion`

```sql
guardar_cotizacion(
  p_quote     uuid,         -- la cotización
  p_esperado  timestamptz,  -- el updated_at que vio el navegador al entrar a editar
  p_cabecera  jsonb,        -- SÓLO los campos que cambiaron
  p_lineas    jsonb         -- el ESTADO DESEADO completo de las líneas
) returns jsonb
```

`security definer`, `set search_path = public, app, pg_temp`.

Devuelve `{ ok, updated_at, cambios_cabecera, lineas_tocadas }`. El `updated_at` que vuelve es
el que el navegador usa como testigo para la edición siguiente: el trigger de totales lo vuelve
a mover cuando cambian las líneas, así que se relee al cierre.

Orden interno:

1. **Documento y permiso** — `select ... for update` (ver §7), rol de la membresía activa.
2. **Estado** — sólo los estados editables; si no, `ESTADO_NO_EDITABLE`.
3. **Concurrencia** — compara `updated_at` con `p_esperado`.
4. **Payload cerrado** — whitelist de campos (ver §5).
5. **Validaciones de negocio** — cliente, contacto, vendedor, tarifa, moneda.
6. **Cabecera** — un solo `update`, y el diff campo por campo.
7. **Líneas** — alta, modificación y borrado por diferencia contra el estado deseado.
8. **Auditoría** — un evento, y sólo si cambió algo.

`p_lineas` es el estado deseado, no un diff de operaciones: el cliente no puede pedir «borrá la
línea X» de una cotización que no es suya. El servidor compara contra lo que hay y decide.

**Reutilizable, sin abstraer de más.** La forma —testigo, payload cerrado, estado deseado de
líneas, diff real— es la que va a usar Pedido en E3, pero E2 no generaliza nada: `guardar_pedido`
va a ser su propia función, con su propia whitelist y sus propias reglas de estado.

---

## 4. Cambio de schema

```sql
alter table sales_quotes add column if not exists price_list_id uuid references price_lists(id);
```

Una columna, nullable, sin backfill. Es el único gap de schema que E0 marcó con prioridad alta:
hasta ahora la lista de precios vivía sólo en `customers.default_price_list_id`, que es un dato
**actual** y no dice con qué lista se cotizó en su momento. Por eso E1 se negó a mostrar una
tarifa en el documento.

- Los 306 documentos históricos quedan en `NULL`, que se lee «sin tarifa registrada». Rellenarlos
  por intuición sería inventar.
- **No** se agrega a `sales_orders` ni a `deliveries`: hoy no los edita nadie y serían dos
  columnas siempre vacías. El `unit_price` de cada línea ya viaja como snapshot al convertir, así
  que lo que falta es la metadata, no plata. Queda anotado para la entrega que haga Pedido.
- La tarifa **sugiere** precio; no lo impone. Cambiarla no reescribe ninguna línea: no hay
  «recalcular todos» y no se agregó ninguno.

`DB_CHANGES = 2` (una columna, una función). Ninguna policy se modificó; el rollback está al pie
del `.sql` y no deja RLS rota.

---

## 5. Validación

### Payload cerrado

Los únicos campos de cabecera que se aceptan:

```
customer_id · contact_id · quote_date · title · salesperson_id · payment_terms
currency_code · price_list_id · notes · valid_until · exchange_rate
discount_pct · perception_pct
```

Cualquier otra clave en `p_cabecera` corta con `CAMPO_NO_PERMITIDO` y el nombre del campo en el
`detail`. Sin esto, un cliente con sesión podría mandar `company_id`, `number`, `series_code`,
`status`, `created_by`, `imported_at` o `external_id`. La suite lo prueba campo por campo.

### Errores de negocio

| Código | Cuándo | Qué ve la persona |
| --- | --- | --- |
| `COTIZACION_INEXISTENTE` | El id no existe | «La cotización ya no existe.» |
| `SIN_PERMISO` | Rol sin escritura, o de otra empresa | «Tu rol no edita cotizaciones.» |
| `ESTADO_NO_EDITABLE` | Cerrada / cancelada | «La cotización ya está cerrada y no se puede modificar.» |
| `CONFLICTO_DE_EDICION` | Alguien guardó en el medio | «Alguien más guardó esta cotización mientras la editabas…» |
| `CABECERA_INVALIDA` / `LINEAS_INVALIDAS` | El payload no es objeto / array | genérico |
| `CAMPO_NO_PERMITIDO` | Clave fuera de la whitelist | «Se intentó guardar un campo que no se puede editar.» |
| `CLIENTE_INVALIDO` | Cliente de otra empresa | «El cliente elegido no es válido.» |
| `CONTACTO_DE_OTRO_CLIENTE` | Contacto que no es del cliente | «El contacto elegido es de otro cliente.» |
| `VENDEDOR_INVALIDO` | Vendedor sin membresía activa | «El vendedor elegido no es de esta empresa.» |
| `TARIFA_INVALIDA` | Tarifa de otra empresa | «La tarifa elegida no es de esta empresa.» |
| `TARIFA_OTRA_MONEDA` | Tarifa ARS en documento USD | «La tarifa está en otra moneda que el documento…» |
| `PRODUCTO_INVALIDO` | Producto de otro catálogo | «Una de las líneas tiene un producto que no es del catálogo…» |
| `CANTIDAD_INVALIDA` | Cantidad 0 | «Una línea tiene cantidad cero.» |
| `DESCUENTO_INVALIDO` | Fuera de 0–100 | «Un descuento está fuera del rango 0–100 %.» |
| `PRECIO_INVALIDO` | Precio negativo | «Un precio es negativo.» |
| `LINEA_AJENA` | Línea de otra cotización | «Una de las líneas no pertenece a esta cotización.» |

El navegador no adivina: `MOTIVOS_GUARDADO` mapea código → frase, y lo desconocido cae en «No se
pudo guardar la cotización». Nunca se muestra el texto crudo de Postgres.

### En el editor, antes de llegar al servidor

- Cambiar de cliente **limpia el contacto** y avisa por qué (un contacto de otro cliente no es un
  dato, es un error).
- Cambiar de moneda **limpia la tarifa** si queda incompatible, y avisa.
- La lista de tarifas ofrece sólo las de la moneda del documento.
- El SKU de una línea con producto del catálogo es de sólo lectura: la línea ya apunta al
  producto y el texto sería una mentira.

---

## 6. Auditoría con el valor anterior

Un evento `updated_sensitive_fields` por guardado, y **sólo si cambió algo**: apretar «Guardar»
sin tocar nada no ensucia el historial.

El `diff` es real —`from` y `to` leídos de la fila antes y después del `update`, no lo que el
cliente dijo que iba a mandar—, acotado a la whitelist: los totales y las marcas de tiempo quedan
afuera porque los mueve el servidor, no la persona.

```jsonc
{
  "title":         { "from": "ZZ Provisión de herramientas", "to": "ZZ Provisión revisada" },
  "contact_id":    { "from": null, "to": "4684d90d-…" },
  "lineas": [
    { "accion": "modificada", "linea": 1, "producto": "ZZ-100",
      "cambios": { "quantity": { "from": 4, "to": 6 } } },
    { "accion": "eliminada",  "linea": 2, "producto": "ZZ-200", "cantidad": 1, "precio": 450 }
  ]
}
```

La pestaña **Trazabilidad** de E1 ya lo muestra, sin esperar a E3 (`lib/trazabilidad.ts`):

```
Cambio en precios o cantidades
  Título: ZZ Provisión de herramientas → ZZ Provisión revisada
  Línea 1 (ZZ-100): cantidad 4 → 6
  Línea 2 (ZZ-200): eliminada (era 1 × 450)
  Contacto: se asignó
  Tarifa: se asignó
  Vendedor: se asignó
  16/09/2026, 05:21 p. m. · ZZ Admin E2
```

Los campos que guardan una referencia (`customer_id`, `contact_id`, `salesperson_id`,
`price_list_id`) **no muestran el uuid**: se cuenta qué pasó —se asignó, se quitó, cambió—, que
es la información que hay. Un uuid en pantalla no le dice nada a nadie.

---

## 7. Concurrencia

Optimista sobre `updated_at`. El navegador manda el valor que leyó al entrar en edición
(`p_esperado`); si no coincide, `CONFLICTO_DE_EDICION` y no se escribe nada. **No hay merge
automático**: mezclar dos ediciones sin que nadie lo decida es peor que no guardar.

En pantalla aparece un `Alert` con el título «Este documento cambió mientras lo estabas editando»,
un botón **Recargar**, y la aclaración de que lo escrito **sigue en pantalla** para poder anotarlo
antes de recargar.

Dos detalles que costaron:

- **`for update`.** La primera versión leía el snapshot sin bloquear la fila, y el control era
  decorativo: dos guardados simultáneos leían el mismo `updated_at`, los dos pasaban y los dos
  escribían. Un doble clic alcanzaba. Ahora la lectura bloquea, y serializa sólo los guardados de
  esa cotización.
- **El SQLSTATE.** `CONFLICTO_DE_EDICION` se lanzaba con `errcode = '40001'`
  (`serialization_failure`) — y PostgREST **reintenta** ese código: el navegador quedaba 125
  segundos colgado hasta un timeout de gateway. Ahora usa el `P0001` por defecto y el conflicto
  vuelve como 400 inmediato.

---

## 8. Cálculos

**Ninguna fórmula cambió.** Los totales los sigue calculando el servidor con la lógica que ya
existía (trigger de totales sobre las líneas, descuento global y percepción). La RPC no los
escribe ni los acepta del cliente: un total que manda el navegador es un total que se puede
falsificar.

El editor muestra una **previsualización** (unidades, subtotal) con el aviso de que «los totales
definitivos los calcula el servidor al guardar, a partir de las líneas, el descuento global y la
percepción». Impuestos y total se muestran como «—» mientras se edita en vez de arriesgar un
número que puede no coincidir.

---

## 9. Editor de líneas

- **Controles controlados** (`value` + `onChange`), no `defaultValue` + `onBlur`. Con
  `defaultValue`, «Descartar» restauraba los datos pero dejaba en pantalla lo tipeado: un descarte
  que se ve a medias no es un descarte.
- **Producto y Descripción son dos columnas distintas.** La que antes decía «Descripción» era en
  realidad el nombre del producto (`name_snapshot`). Ahora `description_snapshot` es un campo
  propio, editable, con el texto comercial de la línea — y se guarda sin tocar el catálogo.
- Agregar, eliminar y reordenar líneas (`↑ ↓`) ocurren en el borrador; el `line_no` viaja en el
  payload y el servidor lo aplica al guardar.
- La identidad de la línea es su `id`, no su posición en el array. Las líneas nuevas van sin `id`
  y el servidor las inserta.

---

## 10. Responsive

- **≥ 900 px**: tabla con las columnas `# · Referencia · Producto · Descripción · Cant. · Precio ·
  % Dto. · Impuesto · Subtotal` y las acciones de fila.
- **≤ 899 px**: cada línea es una tarjeta con sus rótulos, la misma que usa `TablaLineas`. El
  corte está en 900 y no en 767 porque a 768 la tabla todavía desbordaba.
- Verificado a 390 y 430 px con el documento en edición: `scrollWidth === clientWidth`, sin scroll
  horizontal. El único elemento con overflow propio es la tira de pestañas, que scrollea a
  propósito desde E1.
- La cabecera del editor es una grilla que colapsa a una columna; los `fieldset`/`legend` agrupan
  «Cliente y referencia», fechas, moneda y condiciones.

---

## 11. Seguridad

```
prosecdef  = true                          (security definer)
proconfig  = search_path=public, app, pg_temp
acl        = postgres=X | authenticated=X | service_role=X
```

- **`anon` no tiene EXECUTE.** Los default privileges del proyecto le dan EXECUTE a `anon` y
  `authenticated` sobre toda función nueva de `public`, y son grants explícitos por rol: un
  `revoke ... from public` **no** los saca. Hay que nombrarlos — la lección de la Fase 16 E1.
- Empresa exacta: la función resuelve la membresía activa del `auth.uid()` y compara contra el
  `company_id` del documento. Cliente, contacto, vendedor, tarifa y producto se validan contra esa
  misma empresa.
- **Ninguna policy se tocó y la RLS no se abrió** para facilitar E2. La suite corre con las
  credenciales de usuarios reales creados al vuelo, no con la service key, salvo para armar y
  limpiar los fixtures.
- E2 no toca `authority`, ni `number`, ni `series_code`, ni `status`: no están en la whitelist.

---

## 12. Tests

### Base — `scripts/fase15-e2-guardar-cotizacion-tests.mjs`

**67 comprobaciones, 0 fallos.** Nueve secciones:

1. Cabecera, líneas y las dos juntas
2. Tarifa y moneda
3. Cliente, contacto y vendedor
4. Campos inyectados (`company_id`, `number`, `status`, `created_by`, `external_id`…)
5. Rollback: o entra todo o no entra nada
6. Concurrencia optimista (incluye el doble guardado simultáneo)
7. Estado y roles
8. Auditoría con el valor anterior
9. Limpieza e invariantes (cada tabla vuelve a su conteo; «no queda ninguna empresa de prueba»)

Se corre con las variables del proyecto:

```bash
node --env-file=.env --env-file=.env.migration scripts/fase15-e2-guardar-cotizacion-tests.mjs
```

### Frontend

| Archivo | Tests |
| --- | --- |
| `lib/borrador.test.ts` | 28 — el borrador puro: cambios, cliente que limpia contacto, moneda que limpia tarifa, alta/baja/orden de líneas, `hayCambios`, payload |
| `pages/CotizacionDetallePage.test.tsx` | 24 — incluye **«NO se escribe nada hasta apretar Guardar»**, con un espía del servicio que debe quedar en cero |
| `lib/trazabilidad.test.ts` | 8 — incluye el render de `lineas` y que un campo de referencia **no** muestre el uuid |

`npx vitest run`: **1132 tests, 109 archivos, 0 fallos**. `npm run test:isolated`: idéntico.
`tsc -b --noEmit`, `eslint .` y `npm run build`: limpios.

### Verificación en el navegador (fixture `zz-e2ui`, cotización `ZZQ-0001`)

1. Con el editor abierto: cantidad 4→6, descripción nueva, línea 2 eliminada, contacto, tarifa,
   vendedor y título cambiados. Consulta directa a la base: `title` viejo, `contact_id`,
   `salesperson_id` y `price_list_id` en `null`, `subtotal 885`, 2 líneas, **0 eventos**.
2. «Guardar cambios»: `subtotal 720`, `total 871,20`, 1 línea, 1 evento con el diff de arriba.
3. Segunda ronda de edición + «Descartar»: `updated_at` intacto (`20:21:40`), cantidad 6, 1 línea,
   1 evento. El descarte no escribió nada.
4. Trazabilidad renderizada sin ids ni JSON; 390 y 430 px sin scroll horizontal.

El fixture y la empresa de prueba se borraron al terminar.

### Base de datos, después de todo

```
sales_quotes 306 · sales_quote_lines 1032 · sales_orders 172 · deliveries 193
products 21828 · price_lists 4 · sales_audit 2 · document_sequences 20
document_numbering_authority 3 · stock_movements 381 · empresas zz 0
```

Idéntico al baseline de partida.

---

## 13. Lo que queda para E3

- **Pedido y Remito.** `guardar_pedido` con su propia whitelist (sin `quote_date`, con las reglas
  de estado del pedido) y el mismo editor de líneas. E2 no los tocó.
- **`price_list_id` en `sales_orders` / `deliveries`**, junto con la conversión que lo propague.
- **Alta de cotización** con el mismo modelo: hoy «Nueva» sigue por el camino viejo.
- **Buscador de producto** al agregar línea: hoy la línea nueva nace libre y el SKU se escribe a
  mano; el catálogo entra sólo por «Añadir producto».
- **Capítulos**: se editan y ordenan, pero no hay jerarquía real (indentar, colapsar, subtotal por
  capítulo).
- **Adjuntos** sigue en sólo lectura.
- **Recalcular precios desde la tarifa** — pendiente de decisión: cambiar la tarifa hoy no reescribe
  ningún precio, y no se agregó ningún «recalcular todos» sin autorización.
- **Trazabilidad**: falta paginado cuando un documento acumule muchos eventos (hoy trae 200).
