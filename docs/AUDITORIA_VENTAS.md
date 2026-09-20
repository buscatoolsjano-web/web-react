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

**STOP.** No se escribió nada. Hace falta tu autorización específica.

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
