# Auditoría de Ventas — antes de tocar nada (F19 · E1)

Fecha: 2026-09-20. Proyecto: `uaxcfufvapzulqvynanp`. Sólo lecturas.

> Mismo criterio que en Clientes: **primero medir con los datos reales**. Lo que sigue
> incluye lo que me hizo *no* hacer cosas que estaban en la lista.

---

## 1 · Baseline de producción

| | |
|---|---|
| `sales_quotes` / `sales_quote_lines` | 306 / 1.032 |
| `sales_orders` / `sales_order_lines` | 172 / 600 |
| `deliveries` / `delivery_lines` / `delivery_serials` | 193 / 631 / **0** |
| `sales_audit` | 2 |
| `attachments` | **0** |
| `stock_movements` / `stock_balances` | 381 / 379 |
| `document_sequences` | 20 · `authority` 3 · `authority_series` **1** |
| `max(updated_at)` cotiz. / ped. / entr. | 16/09 14:21 · 16/09 14:33 · 17/09 21:59 |

**Casi todo es migrado**: 193 de 193 entregas y 171 de 172 pedidos tienen `imported_at`.
Eso condiciona buena parte de lo que sigue.

## 2 · El bug que ya estaba anotado: `aplicarDefaults`

**Cerrado.** Y el diagnóstico que había en el repo era el equivocado.

El commit `944d1e2` —que está en producción— le subió el `waitFor` a 8 segundos y
concluyó: *«No es un bug del código: es la misma espera corta… bajo la carga de la
suite completa la respuesta de los defaults llega después»*. Era al revés: la
respuesta llega **antes**.

Al elegir un cliente pasaban dos cosas seguidas:

```js
setB(r.borrador)        // 1. el cliente entra en el borrador (queda encolado)
pedirDefaults(id)       // 2. sale la consulta; al volver, aplica sobre una referencia
```

La referencia (`borradorAlDia`) la sincronizaba un `useEffect`. **React agenda los
efectos pasivos, no los corre en el acto**, así que una promesa ya resuelta gana la
carrera: la referencia todavía apuntaba al borrador ANTERIOR al click y el `setB`
posterior **pisaba el cliente recién elegido**. En los tests fallaba 1 de cada 6
veces; en producción la red casi siempre tarda más que el efecto y por eso no se veía.

**Reproducción determinista**: un *thenable* que ejecuta su callback en el acto,
dentro del mismo manejador del click. Es el extremo de la misma ventana, sin
depender del planificador. Con el código viejo falla **siempre**.

El detalle que confirma el diagnóstico: de los tres tests nuevos, el que comprueba
que **los defaults se aplican** pasaba también con el código viejo. Lo que se perdía
no eran los defaults: era el cliente.

**Arreglo**: los defaults se aplican en un **efecto**, no en el `.then()`. Un efecto
corre después del commit, así que ve el borrador de verdad; no hay referencia que
pueda quedar vieja porque no hay referencia. Se eliminaron `borradorAlDia` y
`tocadosAlDia` de las dos pantallas.

Dos cosas que aparecieron al arreglarlo:

- **Las tarifas podían no haber llegado.** Si los defaults del cliente ganan la
  carrera a la lista de tarifas —el caso del cliente que viene en la URL, donde las
  consultas salen juntas—, la tarifa sugerida se descartaba por «no existe en la
  empresa» y encima se avisaba. Ahora el efecto reintenta cuando llegan las listas.
- **La referencia también silenciaba al linter.** `react-hooks/set-state-in-effect`
  no saltaba porque el valor venía de una referencia. Al leer el estado de verdad,
  saltó. El encadenamiento se cortó con una guarda por firma, no apagando la regla.

Se quitaron los `timeout: 8000` que tapaban la carrera. **Seis corridas seguidas en
verde** de los dos archivos que fallaban 1 de cada 6.

## 3 · Listas: los filtros que pedías y los datos que hay

| Filtro | Evidencia | Veredicto |
|---|---|---|
| búsqueda, período, cliente, estado, moneda | ya existen | mantener |
| **vendedor** | **0 de 306 cotizaciones y 0 de 172 pedidos tienen vendedor** | **no construir** |
| **serie** | cotizaciones: sólo `COTI`. Entregas: `RT` y `RT-ML` | sólo tendría sentido en entregas, y separa 2 valores |
| **estado (entregas)** | **193 de 193 están `delivered`** | el filtro existe y hoy no separa nada |
| **origen** | 152 de 172 pedidos vienen de cotización; 156 de 193 entregas, de pedido | **sí**: aísla los 20 y 37 cargados a mano |
| **pendientes de entrega** | 27 pedidos `pending` | **sí**: es trabajo pendiente de verdad |

Es la misma lección que el rubro en Clientes: un filtro por vendedor sobre 0 filas no
es una mejora, es ruido. Lo que sí separa algo es «qué me falta entregar».

Monedas en uso: ARS, EUR y USD en cotizaciones. **Cualquier total va por moneda.**

## 4 · Avance de entrega: derivarlo de las líneas hoy MIENTE

El §17 pide no depender del `status` si se puede derivar. Lo medí, y acá no se puede:

| | |
|---|---|
| líneas de pedido | 600 |
| sin entregar / parciales / completas | 117 / 22 / 461 |
| **líneas de entrega sin `order_line_id`** | **147 de 631 (23 %)** |
| pedidos `delivered` con alguna línea «pendiente» al derivar | **29** |
| pedidos `pending` con todas las líneas completas | 0 |

Las 193 entregas son migradas y en 147 líneas **el vínculo con la línea del pedido no
se migró**. Derivar el avance sólo de las líneas mostraría **29 pedidos entregados
como si faltara entregarlos**.

El diseño honesto para E4/E5: derivar por línea **donde el vínculo existe**, y decir
que no se puede afirmar donde no existe. Nunca contradecir al `status` con una
derivación que no tiene con qué.

Además hay **2 líneas con más entregado que pedido** (PDV01181: 1 pedida / 2
entregadas; PDV01238: 4 / 7), las dos migradas. La pantalla tiene que mostrarlas sin
inventar un «pendiente» negativo. Son fixture natural para los tests.

## 5 · Lo que falta y es real

- **La ficha rápida de cliente NO se usa en Ventas.** Verificado: cero referencias a
  `FichaRapidaCliente` en `src/modules/ventas`. El componente ya es reutilizable
  (F19 · E1 lo dejó suelto justamente para esto). Es la mejora más barata del §9.
- **`PanelAdjuntos` está dos veces** (Ventas 215 líneas, Clientes 228) y **no son el
  mismo componente**: difieren en imports, estados vacíos y confirmación de borrado.
  Consolidarlos es refactorizar código que hoy no usa nadie: `attachments` tiene
  **0 filas**. Queda anotado, no hecho.
- **`delivery_serials` está vacía** (0 filas): no hay seguimiento de series/lotes en
  uso. No diseñar UI para eso.

## 6 · COT-ERP — las dos filas exactas (NO aplicadas)

El mecanismo **ya existe y está en uso**: `document_numbering_authority_series` tiene
hoy una fila, `delivery / RT-ML / STEL`.

Y la resolución está probada en el cuerpo de `app.autoridad_efectiva(company, doc_type, series)`:

```sql
if p_series <> '' then
  select authority from document_numbering_authority_series
   where company_id=... and doc_type=... and series_code=p_series;
  if found then return esa;     -- ← la serie gana
end if;
select authority from document_numbering_authority
 where company_id=... and doc_type=...;   -- ← si no, la general
return coalesce(..., 'ERP');
```

Primero mira la serie; **sólo si no hay fila** cae a la autoridad general. Por eso una
fila para `COT-ERP` no puede alterar lo que pasa con `COTI`: son claves distintas.

| # | Tabla | Valores propuestos |
|---|---|---|
| 1 | `document_sequences` | `doc_type='quote'`, `series_code='COT-ERP'`, `next_number=1` |
| 2 | `document_numbering_authority_series` | `doc_type='quote'`, `series_code='COT-ERP'`, `authority='ERP'`, `reason='piloto F19'` |

Estado actual y resultado esperado:

| Consulta | Hoy | Después |
|---|---|---|
| `autoridad_efectiva(BT,'quote','COT-ERP')` | `STEL` (cae a la general) | **`ERP`** |
| `autoridad_efectiva(BT,'quote','COTI')` | `STEL` | **`STEL`** (sin cambio) |
| `autoridad_efectiva(BT,'quote','')` | `STEL` | **`STEL`** (sin cambio) |
| `document_numbering_authority` para `quote` | `STEL` | **`STEL`** (no se toca) |
| `document_sequences` `quote/COTI` | `next=2630` | **`next=2630`** (no se toca) |

**APLICADO el 20/09/2026** con autorización explícita, en una sola sentencia `DO` con **20
invariantes verificadas antes del commit**. Resultado medido después:

| | |
|---|---|
| autoridad general de `quote` | `STEL` |
| filas por serie | `delivery/RT-ML=STEL` · `quote/COT-ERP=ERP` |
| secuencias de `quote` | `COT-ERP next=1` · `COTI next=2630 (default)` |
| documentos cot./ped./entr. | 306 / 172 / 193 (sin cambios) |
| `stock_movements` | 381 (sin cambios) |

`is_default=false` en COT-ERP es lo que impide que se vuelva la serie por defecto:
un documento que no pide serie sigue tomando COTI.

El primer intento **abortó solo**: una invariante mía estaba mal escrita —afirmaba
cero filas por serie para la empresa, cuando `delivery/RT-ML` ya existía y es de
ella—. No se escribió nada y se corrigió la afirmación, no el dato.

**Todavía NO se creó ninguna cotización piloto**: eso es de E3.

## 7 · Orden de entregas propuesto

Mantengo el que pediste, con una corrección que la auditoría justifica:

| | |
|---|---|
| **E1** | bug `aplicarDefaults` + esta auditoría ✔ |
| **E2** | listas: origen y pendientes de entrega; **sin filtro por vendedor** |
| **E3** | cotización: alta, detalle, editor de líneas, preview |
| **E4** | pedido: avance de entrega **con el vínculo que exista**, no derivado a ciegas |
| **E5** | remito |
| **E6** | pipeline, relacionados y **ficha rápida de cliente reutilizada** |
| **E7** | mobile, performance y cierre |

E6 podría adelantarse: la ficha rápida ya existe y no depende de E2–E5. Si querés
valor visible antes, es la de mejor relación esfuerzo/resultado.

---

## 8 · E2 · Lo aplicado en las listas

### Filtros

| Filtro | Estado | Por qué |
|---|---|---|
| búsqueda, período, cliente, estado, moneda, observaciones | ya estaban | — |
| **serie** | **nuevo** | sólo aparece si el documento tiene más de una serie en uso. Hoy: entregas (`RT` 188 · `RT-ML` 5). En cotizaciones aparecerá cuando `COT-ERP` tenga documentos, que es justo cuando hay que distinguir el piloto de lo productivo |
| **origen** | **nuevo** | pedidos: 152 desde cotización / **20 a mano**. Entregas: 156 desde pedido / **37 a mano**. No existe en cotizaciones: son el principio de la cadena |
| **pendientes de entrega** | **nuevo**, sólo pedidos | **27**. Es trabajo pendiente de verdad |
| ~~vendedor~~ | **rechazado** | 0 de 306 cotizaciones y 0 de 172 pedidos tienen vendedor |

Verificado contra producción, y los números coinciden con la auditoría: 27 · 20 · 152 · 37 · 188 · 5.

«Pendiente de entrega» pregunta por `fulfillment_status <> 'delivered'` y no por
`= 'pending'`, para que un futuro «entregado en parte» siga contando como pendiente.

### El regreso al listado

El «← Pedidos» del detalle era una ruta fija, así que perdía filtros, página y
orden. El «atrás» del navegador sí los conservaba —viven en la URL desde la Fase
15—, con lo cual **el botón de la pantalla era peor que el del navegador**.

Ahora el listado le pasa su query string al detalle por el `state` del router, y
el detalle vuelve a donde estaba. Va en el `state` y **no** en el `href` del
documento a propósito: la URL de un pedido tiene que seguir siendo
`/ventas/pedidos/<id>` y nada más, para poder compartirla sin arrastrar el filtro
de quien la abrió. Quien llega por un link directo no trae `state` y vuelve al
listado sin filtros, que es lo correcto: nunca estuvo en uno.

Verificado: desde `?pendiente=1&page=2&orden=total&dir=asc`, abrir un pedido y
mirar el link de vuelta devuelve esa misma cadena.

### Un segundo bug de la misma familia

Buscando por qué seguía fallando un test 1 de cada 6, apareció otro, **distinto
del de E1 y también de producción**:

```js
const crear = useMutation({
  mutationFn: () => {
    const payload = aPayloadCreacion(b)   // ← cierra sobre el estado
```

React Query v5 fija las opciones del observer **en un efecto**. Apretar «Crear
cotización» en el mismo tick en que entran los defaults del cliente mandaba el
borrador del render anterior: **la pantalla mostraba la moneda y la tarifa, y el
documento se creaba sin ninguna de las dos**. El test lo demuestra ahora
afirmando los cuatro valores en pantalla justo antes de crear.

Arreglado pasando el payload **como variable de la mutación**, armado en el
`onClick`, que sí es del render que la persona está viendo.

### Qué se puede afirmar y qué no

| | |
|---|---|
| **Confiable** | el total por tipo y estado; el conteo de pendientes por `fulfillment_status`; el origen por la FK; la serie |
| **No confiable hoy** | el avance **por línea** en documentos migrados: 147 de 631 líneas de entrega no tienen `order_line_id` |
| **No se afirma** | que un pedido «delivered» esté realmente completo línea por línea: en 29 casos no hay con qué comprobarlo |

Por eso E2 **no** deriva progreso por línea. El filtro de pendientes usa el estado
que el servidor mantiene, que sí es confiable: 0 pedidos marcados `pending` tienen
todas sus líneas completas.

---

## 9 · E3 · La cotización

### El fallo intermitente: NO reproducido

Se persiguió como pedía el §1, sin subir timeouts ni silenciar nada.

| | |
|---|---|
| corridas del módulo tras el arreglo del payload | **57** |
| fallos observados | **1**, antes de instrumentar |
| corridas **instrumentadas** | **45** (30 + 15) |
| fallos con instrumentación | **0** |

La instrumentación quedó puesta: el espía del alta captura **lo que se ve en
pantalla en el instante en que se dispara la mutación**, y la aserción compara
las dos mitades juntas. Si vuelve a pasar, el mensaje del fallo va a decir qué
mostraba la pantalla y qué se mandó, que es exactamente lo que faltó la primera
vez.

**No se declara causa raíz de algo que no se reprodujo.** Lo que sí se corrigió,
con causa demostrada, fueron dos bugs distintos: el de E1 (los defaults
aplicados sobre un borrador viejo) y el de E2 (`mutationFn` cerrando sobre el
estado). El segundo explica el síntoma exacto que se veía —payload prístino con
cliente puesto— y desde entonces no volvió a verse.

**Por eso no se creó la cotización piloto.** La regla del §1 es «no avanzar a
piloto real si `FAILURES_AFTER_FIX > 0`», y hubo 1. Crear un documento real en
producción es de las cosas que no conviene apurar con una puerta a medio cerrar.

### Vista previa en vivo

Se arma desde el borrador en memoria, **sin guardar nada**, con el MISMO
`VistaImpresion` que imprime el documento ya creado: no hay dos formatos. Lo que
la previa no puede saber, lo dice en vez de inventarlo —«N° a asignar al crear»,
y el total definitivo lo calcula el servidor con el descuento global y la
percepción—.

Desde 1440 px va al lado del editor y no hay botón que apretar; abajo de eso se
abre con «Vista previa». Al costado la hoja A4 (794 px) no entra en la columna de
544, así que se la achica en bloque —no se re-maqueta— para que se vea entera: una
previsualización que obliga a scrollear en horizontal no previsualiza nada.

La única consulta que agrega es la del membrete, y usa la **misma clave** que el
modal de impresión: si ya se imprimió algo, sale de la caché. El nombre del
cliente también: misma clave que `BuscadorCliente`.

### Ficha rápida del cliente

El nombre del cliente en la pestaña «Información» es ahora un botón que abre la
ficha 360 **sin salir de la cotización**. Es el mismo `PanelLateralCliente` que
usa el listado de Clientes, no una copia: se había dejado suelto en la Fase 19 · E1
justamente para esto. Verificado en producción sobre COTI02629.

### Lo que ya estaba bien y no se tocó

- **El pipeline (§16) ya existe**: `PanelRelacionados` muestra cotización → pedido
  → entregas **siempre**, incluso vacías, porque «que un documento NO tenga pedido
  es información»; y NO muestra facturas ni cobranzas, que tienen cero filas. Es
  exactamente lo que pedía el prompt.
- **El detalle ya conserva la pestaña en la URL** (`?tab=informacion`).
- **La impresión ya es una sola fuente**: un árbol de React y una hoja `@media
  print`. No se agregó ninguna librería de PDF.

---

## 10 · El piloto COT-ERP no se puede crear con el flujo actual

Autorizado el piloto, el preflight pasó entero:

| | |
|---|---|
| autoridad general `quote` | `STEL` |
| serie `quote/COT-ERP` | **`ERP`** |
| serie `quote/COTI` | sin fila → cae a la general (`STEL`) |
| secuencia `COTI` / `COT-ERP` | 2630 / 1 (`COT-ERP` con `is_default=false`) |
| baseline | 306 cotizaciones · 1.032 líneas · 172 pedidos · 193 entregas · 381 movimientos · 0 reservas |

**Y ahí se frenó.** `crear_cotizacion` no acepta la serie:

```sql
k_permitidos constant text[] := array[
  'customer_id', 'contact_id', 'quote_date', 'title', 'salesperson_id',
  'payment_terms', 'currency_code', 'price_list_id', 'notes',
  'valid_until', 'exchange_rate', 'discount_pct', 'perception_pct'
];              -- ← `series_code` NO está

select ds.series_code into v_serie
  from document_sequences ds
 where ds.company_id = p_company and ds.doc_type = 'quote' and ds.is_default;
v_numero := next_document_number(p_company, 'quote', '');   -- ← serie vacía
```

Toma **siempre la serie por defecto** —COTI— y pide el número con serie vacía.
Como COTI resuelve a STEL, el alta queda bloqueada, que es justamente lo que se
ve en pantalla. **No hay forma de emitir en COT-ERP desde el flujo React.**

### Lo que falta es poco, y el resto ya está hecho

`next_document_number(p_company, p_doc_type, p_series)` **ya acepta la serie** y
**ya exige la autoridad de esa serie**:

```sql
select series_code into v_serie
  from document_sequences
 where company_id = p_company and doc_type = p_doc_type
   and case when coalesce(p_series,'') = '' then is_default else series_code = p_series end;
perform app.exigir_emision_erp(p_company, p_doc_type, v_serie);
```

Y el trigger `guardar_autoridad_numeracion` vuelve a exigirlo al insertar, con
`new.series_code`. O sea: **la base ya sabe permitir COT-ERP y seguir bloqueando
COTI**. Lo único que falta es que la RPC deje elegir.

### El cambio exacto que haría falta (NO aplicado)

En `crear_cotizacion`, tres líneas:

1. agregar `'series_code'` a `k_permitidos`;
2. `v_serie := coalesce(nullif(p_cabecera->>'series_code',''), <la de is_default>)`,
   validando que exista en `document_sequences` para esa empresa y tipo —si no,
   `SERIE_INVALIDA`—;
3. pasar `v_serie` a `next_document_number` en vez de `''`.

Garantías que **no** cambian: la autoridad general sigue decidiendo para quien no
manda serie; COTI sigue en STEL y sigue siendo la serie por defecto; quien pida
COTI explícitamente sigue bloqueado; el permiso sigue siendo `admin`/`employee`.

En la interfaz: un selector de serie que **sólo aparece si la empresa tiene más de
una serie para el tipo**, con la serie por defecto preseleccionada. Nadie cae en
COT-ERP sin elegirla.

**STOP.** Es una RPC `security definer` del camino de numeración, y tocarla no
estaba autorizado: la autorización era crear un piloto asumiendo que el flujo lo
permitía, y no lo permite.

---

## 11 · Serie explícita en `crear_cotizacion` — propuesta (aplicada, ver §12)

SQL completo en [`scripts/fase19-e3-serie-explicita.sql`](../scripts/fase19-e3-serie-explicita.sql),
con la función entera propuesta, las invariantes previas, la verificación
posterior y el rollback.

### El diff, en tres puntos

1. `k_permitidos` suma `'series_code'`.
2. El bloque que resolvía la serie distingue dos casos. **Las dos condiciones
   que importan van en el `where`** —`company_id = p_company` y
   `doc_type = 'quote'`—, así que una serie de otra empresa o de otro tipo de
   documento no aparece y cae en `SERIE_INVALIDA`.
3. `next_document_number(p_company, 'quote', '')` pasa a recibir `v_serie`.

El punto 3 además **corrige una inconsistencia que ya existía**: hoy el número
lo da la serie que `next_document_number` resuelve por `is_default`, y el
`series_code` que se guarda lo resolvió antes la función por su cuenta. Son dos
lecturas distintas de lo mismo; pasando la serie ya resuelta salen por fuerza de
la misma.

### El doble cinturón no se toca

`next_document_number` exige `app.exigir_emision_erp(company, doc_type, serie)`
sobre la serie resuelta, y el trigger `guardar_autoridad_numeracion` lo vuelve a
exigir al insertar con `new.series_code`. **La función no mira la autoridad**:
resuelve la serie y deja que los dos guardianes decidan, que es lo que ya hacían.

### Conducta esperada

| Llamada | Resultado |
|---|---|
| sin `series_code` | COTI → STEL → **bloqueado, igual que hoy** |
| `series_code = 'COTI'` | COTI → STEL → **bloqueado** |
| `series_code = 'COT-ERP'` | ERP → **permitido** |
| serie inexistente | `SERIE_INVALIDA` |
| serie de otra empresa | `SERIE_INVALIDA` |
| serie de otro `doc_type` | `SERIE_INVALIDA` |
| `anon` / `salesperson` / `technician` | `SIN_PERMISO`, sin cambios |

### El selector necesita un objeto más, y conviene decirlo

`document_sequences` **no es legible desde el navegador**: no tiene grant para
`authenticated` ni ninguna policy. Sin una RPC de lectura no hay forma de listar
las series en la pantalla, así que el selector **no sale gratis**.

La propuesta agrega `series_de_documento(p_company, p_doc_type)`, modelada igual
que las dos RPC de autoridad que ya existen: sólo lectura, `security definer`,
misma puerta (`current_internal_company_ids()`), `execute` sólo para
`authenticated`. Devuelve `series_code`, `is_default` y la **autoridad efectiva**,
que es lo que permite rotular «COTI — STEL» y «COT-ERP — ERP» como pedía el §16.

No amplía lo que alguien puede ver: devuelve la configuración de su propia
empresa, que `autoridad_numeracion_series` ya devuelve en parte.

**Es una decisión aparte.** Si preferís no sumar el objeto, el selector no se
puede hacer y el piloto necesitaría otra vía.

---

## 12 · El piloto COT-ERP00001 — lo que probó y los dos defectos que destapó

Aplicadas `crear_cotizacion` (serie explícita) y `series_de_documento`, corridos
los casos A–T y con el selector de serie en el alta, se creó **un solo**
documento desde el React real:

| Clave | Valor |
| --- | --- |
| `PILOT_QUOTE_ID` | `cd384ad9-3a88-4020-8ba8-40e8ee9454b6` |
| `PILOT_QUOTE_NUMBER` | `COT-ERP00001` |
| Cliente | El Gitano (`c95a5a2a-…`), USD, 1 línea, total 157,91 |
| Efectos | COTI sigue en 2630; COT-ERP 1 → 2; 0 pedidos, 0 remitos, 0 movimientos de stock, 0 llamadas a STEL |

Lo que el documento probó en pantalla: cabecera, líneas, totales, las cinco
pestañas, la ficha rápida del cliente, la vista previa y la impresión, el
listado filtrado por serie y el pipeline del inicio (el piloto es borrador, así
que **no** entra en «cotizaciones abiertas», que cuenta enviadas y aceptadas).

La edición segura se probó sobre `notes` —un campo que no mueve plata—: se
escribió, se verificó `persisted == UI` y el evento de auditoría
(`notes: null → …`), y después se devolvió a `null`. Los totales, el estado y la
línea quedaron intactos; el documento se conserva como evidencia.

La **concurrencia optimista** se probó con dos pestañas sobre el MISMO piloto:
la que guardó primero escribió, y la que tenía el snapshot viejo recibió «Este
documento cambió mientras lo estabas editando», **no escribió nada** y conservó
en pantalla lo que la persona había tipeado. La base quedó con el valor de la
primera.

### Defecto 1 — el detalle miraba la autoridad general, no la de su serie

`CotizacionDetallePage` resolvía el bloqueo con `autoridad.stel('quote')`, que es
la autoridad **general** del tipo. El alta ya elegía por serie desde el §4 de la
aprobación; el detalle no. Resultado: el piloto —numerado por el ERP— se abría
con el banner «STEL sigue administrando la numeración de este documento» y con
«Marcar como enviada» y «Marcar aceptada» deshabilitadas sin motivo real.

Ahora manda la serie **del documento**, con la autoridad efectiva que devuelve
`series_de_documento`. Si la serie no estuviera en la configuración se cae a la
autoridad general: no se inventa un permiso que la base no dio. El pedido que
saldría de la cotización sigue mirando la autoridad general de `sales_order`,
porque `convertirCotizacionEnPedido` **no** elige serie: nace con la de por
defecto, que sigue en STEL. Por eso «Generar pedido» sigue bloqueado, y el
título del banner ahora dice que lo que STEL numera son *los documentos que
salen de este*.

### Defecto 2 — la trazabilidad titulaba «precios o cantidades» cualquier edición

El servidor guarda toda la edición con la misma acción
(`updated_sensitive_fields`). La pantalla la rotulaba siempre «Cambio en precios
o cantidades», así que el cambio de una observación aparecía en el historial como
si se hubiera tocado la plata. Ahora el título sale del diff: sólo se anuncia un
cambio de importes si lo hubo —un campo de importe, o una línea agregada o
eliminada—; el resto es «Cambio en el documento». El detalle de cada cambio no
cambió.

### Las puertas de entrada al alta (aplicado, ver §13)

`Nueva cotización` sigue bloqueada en el listado, en la ficha rápida y en la
ficha del cliente porque miran la autoridad **general**, que es STEL. Con el
selector de serie, entrar al alta ya no implica poder emitir: la serie por
defecto (`COTI`) deja el botón «Crear» bloqueado con su explicación, y sólo
`COT-ERP` —elegida a propósito— habilita. Abrir esas puertas es **una decisión
tuya**, no un arreglo: amplía a toda la empresa la posibilidad de crear
documentos en la serie piloto. Queda anotado, sin tocar.

---

## 13 · Las puertas de entrada al alta de cotización

Autorizado abrirlas, se abrieron las tres: el listado de cotizaciones, la ficha
rápida del cliente y la ficha completa. La regla nueva es una sola frase: **la
autoridad decide si se puede CREAR, no si se puede ABRIR el formulario.**

Vive en un solo lugar, `useAperturaDeAlta(tipo, habilitado)`:

1. sin bloqueo general, se abre como siempre;
2. con bloqueo general, se abre **sólo si hay una serie que el ERP numere** —y
   sólo para los tipos cuya alta sabe elegir serie, que hoy es la cotización;
3. mientras las series no llegaron, la acción se muestra deshabilitada **y sin
   motivo**: no se promete lo que todavía no se leyó.

Por eso el pedido sigue cerrado y se explica solo: `sales_order` no tiene
ninguna serie del ERP, así que abrir su alta sería llevar a alguien a un
formulario que nunca va a poder guardar. El día que tenga una, y un selector
que la ofrezca, la puerta se abre sola.

**Los roles no se tocaron.** Quien no podía crear sigue sin ver la acción: la
serie no reparte permisos.

Lo que también cambió son los textos, porque con la puerta abierta el cartel de
antes era falso. Donde el alta se puede abrir, el banner del listado dice que
STEL administra **la serie por defecto**, y el alta, cuando bloquea, nombra la
serie y dice qué hacer: «la serie COTI la numera STEL. Elegí una serie que se
emita desde el ERP». La ficha rápida y la ficha del cliente hacen lo mismo.

Verificado en sesión real, escritorio y 375 px: los tres CTA llevan al alta con
el cliente puesto cuando corresponde, los defaults del cliente entran (forma de
pago «30 DIAS F/F con ECHEQ»), la serie arranca en `COTI` con «Crear»
bloqueado, elegir `COT-ERP` lo habilita y volver a `COTI` lo vuelve a
bloquear. **No se creó ningún documento**: `COTI` sigue en 2630 y `COT-ERP`
en 2.

---

## 14 · E4 · Pedidos — auditoría antes de tocar UX

### La limitación equivalente, medida

| | |
|---|---|
| autoridad general `sales_order` | **STEL** |
| series de pedido configuradas | **una sola: `PDV`, por defecto, STEL** |
| series de pedido que numere el ERP | **ninguna** |

Por eso «Nuevo pedido» sigue cerrado y no es una inconsistencia con la
cotización: no hay ninguna serie que elegir. Crear una serie piloto de pedido
**no está autorizado y no se hizo**. Sin ella, todo lo que sigue se puede
mejorar sin emitir ni un pedido real, que es justamente lo que pedía el §9.

### Los datos con los que hay que trabajar

| | |
|---|---|
| pedidos | 172 (171 migrados, 1 nativo) |
| `confirmed` + `delivered` | 145 |
| `confirmed` + `pending` | 26 |
| `draft` + `pending` | 1 |
| con cotización de origen | 152 de 172 |
| líneas de pedido | 600 |
| remitos enlazados a un pedido | 156 de 193 |

`fulfillment_status` es binario en la práctica: **no existe ningún `partial`**.
El avance fino sigue siendo el del §4 —derivar por línea sólo donde el vínculo
existe—, y eso ya está resuelto en `PanelPendientes`, que distingue «no consta
entrega» de «no entregado» y se planta cuando las líneas no se pueden asociar.
Verificado en PDV01315: dice *«2 líneas de entrega no se pudieron asociar… no
se calcula el pendiente por línea»* en vez de inventar un número.

### El hallazgo: 138 avisos que el propio dato desmiente

`review_reason` es **una foto del día de la migración**, y las tres pantallas de
detalle la repetían como si fuera un hecho de hoy:

| motivo | marcados | ya NO es cierto |
| --- | --- | --- |
| `MISSING_CURRENCY` | 17 (6 cot. + 11 ped.) | **17** — todos tienen moneda |
| `UNRESOLVED_SKU` | 59 (39 + 20) | **59** — ninguna línea quedó sin producto |
| `TOTALS_DO_NOT_CLOSE` | 51 (19 + 32) | **48** — cierran con la fórmula del ERP |
| `NO_QUOTE_LINK` | 34 pedidos | **14** — tienen su cotización enlazada |
| `NO_EXCHANGE_RATE` | 75 (48 + 27) | 0 — **sigue siendo cierto** |

El caso que lo destapó es PDV01315: avisaba las cuatro cosas —sin moneda, sin
producto, totales que no cierran, sin cotización— teniendo moneda USD, las dos
líneas resueltas, su cotización enlazada… y un impuesto de cabecera que **sí**
contradice a las líneas (las dos al 0 % contra USD 138,64 de impuesto). O sea:
tres avisos falsos y uno verdadero, todos con el mismo tono.

`revisarMotivos` contrasta cada motivo con el documento y separa lo vigente de
lo resuelto. **No corrige ningún dato histórico** —los totales guardados se
siguen mostrando tal cual, que es la regla de la Fase 4—: sólo deja de afirmar
en presente lo que el dato desmiente. Lo que no se sabe verificar desde el
documento queda **vigente**: no se declara resuelto lo que no se miró, y sin
precio en alguna línea —las 600 líneas de entrega históricas— tampoco se
declara nada.

La pantalla tampoco esconde la otra mitad: el documento **sigue marcado para
revisar**, y lo dice, porque el informe lo sigue listando.

### Queda para decidir (NO aplicado, necesita STOP)

- **Limpiar `needs_review` / `review_reason`** de los 138 avisos que ya no
  aplican es un `UPDATE` sobre documentos productivos. No se hizo. Mientras
  tanto la cola de revisión sigue contando lo mismo que antes, que es
  consistente con lo que se ve en pantalla.
- **Serie piloto de pedido**: no se creó ni se propuso todavía.

---

## 15 · E4 · La revisión, en un solo lugar (aplicado, sólo lectura)

### Dónde vive la regla

Se auditaron las tres opciones. **Vista**, no RPC:

| | |
|---|---|
| RPC de lectura | sirve al detalle, pero el informe no la puede *unir* a sus propias consultas: habría que volver a escribir la regla adentro del informe. |
| Columna almacenada | exige escribir en los documentos —y mantener eso al día con cada edición—. Justo lo que no se quiere. |
| **Vista** | la lee el navegador por PostgREST **y** la une el informe en SQL. Una sola definición, dos consumidores. |

`public.revision_de_documentos`, `security_invoker = true`: no es una puerta,
cada quien ve lo que su RLS ya le deja ver. Devuelve por documento:

```
historical_reasons        lo que marcó la migración, tal cual
active_reasons            STILL_TRUE
resolved_since_migration  RESOLVED_BY_CURRENT_DATA
unverifiable_reasons      UNVERIFIABLE
requires_attention_now    ¿queda algo activo o sin verificar?
```

**`requires_attention_now` deja de pedir atención SÓLO cuando cada motivo se
pudo desmentir.** La falta de evidencia nunca se convierte en «resuelto»: sin
líneas, sin precio en alguna línea, o con un motivo que cuenta *cómo* se
migró, el resultado es `UNVERIFIABLE` y eso sigue pidiendo una mirada.

Lo que NO se tocó: `review_reason`, `needs_review`, `updated_at`,
`sales_audit`, importes ni líneas. Cero escrituras.

### Las reglas, una por motivo

| motivo | resuelto cuando… |
|---|---|
| `MISSING_CURRENCY` | el documento tiene moneda |
| `NO_EXCHANGE_RATE` | tiene tipo de cambio |
| `UNRESOLVED_SKU` | ninguna línea de ítem quedó sin producto (un capítulo no cuenta) |
| `NO_QUOTE_LINK` / `NO_ORDER_LINK` | el vínculo existe hoy |
| `NUMBER_OUTLIER` | `number_outlier` ya no está marcado |
| `TOTALS_DO_NOT_CLOSE` | subtotal, impuesto **y** total coinciden con la fórmula del ERP (± 0,02) |
| el resto | nunca: es historia, y como historia se deja |

La fórmula es la misma del ERP —neto de línea → descuento global → IVA por
línea → percepción—, y por eso un documento **nacido en el ERP no puede tener
totales que no cierren**: el trigger los recalcula. Sólo lo migrado los tiene,
que es exactamente lo que el motivo describe.

### Medido, antes y después

Buscatools, los 672 documentos de Ventas:

| | |
|---|---|
| `RAW_HISTORICAL_REVIEW_COUNT` (marcados en la migración) | **241** |
| `CURRENT_ACTIONABLE_REVIEW_COUNT` (piden atención hoy) | **219** |
| `RESOLVED_HISTORICAL_ONLY` (todo desmentido) | **22** |
| `UNVERIFIABLE_COUNT` (con algo que no se puede comprobar) | **20** |

Y el contador del inicio, que es el del mes:

| | antes | después |
|---|---|---|
| documentos del mes | 80 | 80 |
| «para revisar» | **49** | **45** |
| sólo historia | — | 4 |
| con algo no verificable | — | 3 |

Bajan pocos porque `NO_EXCHANGE_RATE` —75 documentos— **sigue siendo cierto**.
Eso es lo correcto: el contador no tiene que bajar, tiene que ser verdad.

El título del inicio dice ahora «requieren atención» y no «marcados para
revisar»: son cosas distintas y la que se cuenta es la primera.

### En el detalle

El documento sigue diciendo que se marcó en la migración —el informe lo sigue
listando y esconderlo sería mentir por omisión—, pero la advertencia principal
es lo que sigue aplicando hoy. Si todo quedó desmentido, no hay banner
alarmista: una línea que lo cuenta como lo que es, pasado.

### Relacionados

Un documento ya no se muestra relacionado consigo mismo: «Cotización — No hay»
en la pantalla de una cotización no era información. La regla es semántica y
vale para los tres tipos; si existe OTRO documento del mismo tipo, la sección
aparece igual.

---

## 16 · E4 · El pedido también elige serie, y el piloto PDV-ERP00001

### Lo aplicado

| | |
|---|---|
| `PDV-ERP` | `document_sequences` (prefix PDV-ERP, padding 5, next 1, **is_default false**) + `document_numbering_authority_series` con `authority='ERP'` |
| `crear_pedido` | acepta `series_code`: el mismo cambio de `crear_cotizacion` —whitelist, resolución con `company_id` y `doc_type` fijados, `SERIE_INVALIDA`, número con la serie ya resuelta, `series_code` en la auditoría— |
| conversión | `app.convertir_cotizacion_a_pedido(quote, esperado, serie)` interna y compartida; `convertir_cotizacion_en_pedido` **sin cambios de firma ni semántica** llama con serie nula; `convertir_cotizacion_en_pedido_en_serie` es una función NUEVA que **exige** la serie |

Sin sobrecargas: nombres distintos y cantidades de parámetros distintas, así que
ninguna llamada queda ambigua. La interna vive en `app`, que PostgREST no
expone, y sólo la puede ejecutar el dueño; las públicas son `security definer`
con `search_path` fijo y `execute` sólo para `authenticated`.

La autoridad no se mira en ninguna de las tres: la exigen
`next_document_number` y el trigger `guardar_autoridad_numeracion`, cada uno
por su lado. Un `insert` directo en una serie de STEL lo sigue frenando el
trigger (caso L).

### El piloto

| Clave | Valor |
| --- | --- |
| `PILOT_ORDER_ID` | `a9c4f651-f047-4724-998d-9419fc44144d` |
| `PILOT_ORDER_NUMBER` | `PDV-ERP00001` |
| origen | `COT-ERP00001` (`origin='quote'`, `quote_id` enlazado) |
| snapshot | precio 130,50 · cantidad 1 · descuento 0 · `vat_21`/21 · `quote_line_id` enlazado — **idénticos a la cotización** |
| efectos | 172 → **173** pedidos · 193 remitos · 381 movimientos · 0 reservas · PDV **1321 → 1321** · PDV-ERP **1 → 2** · COTI 2630 |
| la cotización | intacta: mismo `updated_at`, sigue en borrador |

El pendiente por línea del piloto **sí es exacto** —pedido 1, entregado 0,
pendiente 1— porque la trazabilidad estructural está completa. Eso no cambia la
regla del §4 para lo migrado: donde falta `order_line_id`, no se inventa.

### Dos defectos que destapó el piloto

1. **El detalle del pedido miraba la autoridad general**, igual que le pasaba a
   la cotización en E3: `PDV-ERP00001` se abría diciendo que STEL numeraba
   «este documento» y con «Confirmar pedido» bloqueado. Ahora manda la serie
   del documento, y lo que sigue en STEL —el remito que saldría de él— se
   nombra como lo que es.
2. **La trazabilidad decía «modificada» en cada línea copiada.** La conversión
   guarda `accion: 'copiada'` y el presentador no la conocía, así que caía en
   el texto por defecto. Copiar no es modificar: ahora dice «copiada de la
   cotización, 1 × 130,5».

---

## 17 · E5 · Remitos — auditoría, y el stock como límite

### La autoridad, medida

| | |
|---|---|
| autoridad general `delivery` | **STEL** |
| serie por defecto | **RT** (prefix RT, padding 10, next **1434**, 188 remitos) |
| `RT-ML` | autoridad **STEL** por fila propia — y **no tiene fila en `document_sequences`**: existe como autoridad y en 5 documentos, pero no como secuencia, así que el selector no la lista |
| otras series de remito | ninguna |
| `RT-ERP` | **no existe** |

Los 193 remitos son todos migrados y todos despachados: **cero borradores** y
cero cancelados en producción.

### Las tres cosas que hace un remito, separadas

| | mueve stock | quién lo permite |
|---|---|---|
| **A · crear borrador** (`crear_remito_desde_pedido`) | **no** | `app.exigir_emision_erp(company,'delivery', serie)` — la serie, antes de numerar |
| **B · editar borrador** (`guardar_remito`) | **no** | el documento tiene que seguir en `draft` |
| **C · confirmar** (`confirmar_entrega`) | **sí** | `app.exigir_emision_erp(company,'delivery')` — **la autoridad GENERAL, sin serie** |

Ese último renglón es el hallazgo: `confirmar_entrega` llama a la versión de
**dos** argumentos, que pasa `null` como serie y por lo tanto mira la autoridad
general. Con `RT-ERP` creada, el borrador se podría crear pero **no se podría
despachar**. Los dos cambios van juntos o no va ninguno.

### `confirmar_entrega`, con precisión

- exige `draft`; `cancelled` da error; cualquier otro estado devuelve
  `ya_confirmada: true` **sin mover nada**;
- toma `select … for update` sobre el remito: dos confirmaciones simultáneas se
  serializan y la segunda ve `shipped`;
- inserta **un `stock_movements` por línea con producto**, `movement_type =
  'sale_delivery'`, cantidad **negativa**, depósito el de la línea (o el
  primero de la empresa). Las líneas sin producto —las históricas— no generan
  movimiento;
- `app.apply_stock_movement` suma ese movimiento a `stock_balances`, así que el
  saldo baja en el mismo momento;
- consume las reservas del pedido en orden de creación, borrando y reinsertando
  el resto;
- pasa el remito a `shipped` a través de `app.workflow_ctx`, que es lo único
  que deja pasar al trigger de estado;
- recalcula `fulfillment_status` del pedido con `app.derivar_cumplimiento`, que
  cuenta **sólo** remitos `shipped`/`delivered`;
- audita `shipped`, y además `stock_consumed` y `reservation_released` cuando
  corresponde.

Medido en el fixture `zz-e5r` (nada de producción): borrador → **0**
movimientos, **0** reservas, saldo intacto y pedido `pending`. Confirmar → un
movimiento de **−4**, saldo −4, pedido `partially_delivered`. Confirmar de
nuevo → `ya_confirmada`, sin movimientos nuevos. Dos confirmaciones a la vez →
**un** solo movimiento. 10 → 4 + 6 → `delivered` y saldo −10. 11 sobre 10 →
`SOBREENTREGA`. Dos borradores de 6 sobre un pedido de 10 → entra **uno**. Un
remito despachado **no se borra** («ya movió stock: borrarlo no devolvería las
unidades»); uno en borrador sí. Y con la serie en STEL **no se puede crear ni
el borrador**.

### El borrador dejó de contar como entregado

`evidenciaDeEntrega` traía las líneas de **todas** las entregas sin mirar el
estado, así que un remito en borrador aparecía como entregado en la pantalla
del pedido. No entregó nada: no movió una unidad. Ahora el pendiente se mide
contra lo que **salió**, y lo que está en un borrador se cuenta en su propia
columna, que sólo aparece cuando hay alguno.

En el remito, los cuatro números del §11: **Pedido · Ya entregado · Esta
entrega · Pendiente después**. Con la misma regla de siempre: si alguna línea
no está enlazada —147 de las 631 migradas—, no se calcula nada y se dice.

### Dos autoridades, dos mensajes

El pedido piloto podía confirmarse y al lado decía «STEL numera los pedidos de
esta empresa», que era el motivo de **Duplicar**. Ahora cada acción explica lo
suyo: lo que gobierna al documento actual es la autoridad de **su** serie, y lo
que gobierna a Duplicar o a Generar remito es la del documento que **crearían**
— «El pedido nuevo saldría en la serie PDV, que numera STEL. Este documento no
se toca».

### Para el piloto de remito, cuando se autorice

`PDV-ERP00001` está en **borrador**, y `crear_remito_desde_pedido` exige el
pedido `confirmed`. Antes de cualquier remito hay que confirmar ese pedido, que
es una acción de emisión sobre una serie del ERP —permitida— pero que **cambia
el estado del piloto**: entra en el mismo STOP.

---

## 18 · E5 · La cadena completa, hasta el borde del stock

`COT-ERP00001 → PDV-ERP00001 confirmado → RT-ERP00001 en borrador`, y ni un
gramo de stock movido. Lo que sigue —despachar— necesita un cambio que **no se
hizo** y una autorización aparte.

### Lo aplicado

| | |
|---|---|
| `PDV-ERP00001` | pasó a **confirmed** desde el React real. Stock 381 → 381, reservas 0, remitos 193 |
| `RT-ERP` | `document_sequences` (prefix RT-ERP, padding 5, next 1, **is_default false**) + autoridad de serie `ERP`, con 13 invariantes verificadas antes del commit |
| `crear_remito_desde_pedido` | acepta `p_serie` opcional: sin serie, la de por defecto; con serie, se resuelve con `company_id` y `doc_type` fijados, `SERIE_INVALIDA` si no existe, número de esa serie y `series_code` en la auditoría |
| `confirmar_entrega` | **NO se tocó** |

Dos cosas que salieron mal en el camino y se corrigieron:

1. **`CREATE OR REPLACE` con un parámetro más no reemplaza: crea otra
   función.** Quedaron la de 4 argumentos y la de 5, y una llamada con 4 las
   satisface a las dos — PostgreSQL la habría rechazado por ambigua. Se borró
   la vieja, con una guarda que verifica primero que la nueva existe.
2. **La función nueva nació con `execute` para PUBLIC**, que en Supabase
   incluye `anon`. La versión anterior lo había revocado en la Fase 15. Se
   restauró igual, y no es cosmético: adentro, el control de empresa es
   `if auth.uid() is not null and …`, así que sin sesión ese `if` no protege
   nada; quien protege es el grant.

### El piloto

| Clave | Valor |
| --- | --- |
| `PILOT_DELIVERY_ID` | `2dd12a2d-3a4d-41c0-a15d-ec04ee6bd42b` |
| `PILOT_DELIVERY_NUMBER` | `RT-ERP00001` · serie RT-ERP · estado **draft** |
| origen | `PDV-ERP00001` (y por él, `COT-ERP00001`) |
| línea | 4134200 × 1, enlazada a la línea del pedido, depósito asignado |
| domicilio | `null` → la pantalla dice **«Sin domicilio registrado»**: el cliente no tiene ninguno y no se inventa |
| efectos | remitos 193 → **194** · líneas 631 → **632** · movimientos **381 → 381** · reservas **0 → 0** · saldos del producto: **sin filas, igual que antes** |
| el pedido | sigue en `confirmed/pending`: un borrador **no** lo pone entregado |
| secuencias | RT **1434 → 1434** · RT-ERP **1 → 2** · PDV, PDV-ERP y COTI intactas |

En pantalla: los cuatro números del avance —pedido 1, ya entregado 0, esta
entrega 1, pendiente después 0— con la nota de que **todavía no salió**;
relacionados muestra la cadena entera; la vista previa imprime `RT-ERP00001`
con su pedido de origen; la ficha rápida del cliente abre sin salir; y a 375 px
no hay desborde.

### El gate

**«Confirmar y despachar» está deshabilitado**, con su motivo. No por una
decisión de la pantalla: `confirmar_entrega` sigue preguntando por la autoridad
**general** de `delivery`, que es STEL. Mientras esa función no cambie, el
piloto no puede mover stock ni por accidente.
