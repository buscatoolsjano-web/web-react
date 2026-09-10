# Fase 5 · Clientes — entregas 1 y 2

Estado: **entregado, pendiente de revisión visual.** La edición (entrega 3) no
está habilitada.

---

## Qué se hizo

| entrega | alcance | escribe |
|---|---|---|
| **2** · Enriquecer el maestro | los 988 clientes del legacy cruzados contra la base, enriquecidos o creados; los 87 contactos con FK real | sí, controlado |
| **1** · Leer | `#/clientes` con listado server-side, filtros en la URL, orden, paginado y CSV; ficha en sólo lectura con Información, Contactos, Historial y Relacionados | no |

Se hizo la 2 antes que la 1 porque una pantalla de sólo lectura sobre 60
clientes no se puede revisar: hacía falta el maestro completo para ver si el
listado y la ficha aguantan los datos reales.

---

## Reconciliación

`node scripts/fase5-reconciliacion.mjs <BuscatoolsERP.html> <erp_store.json>`

### Maestro

| | legacy | base |
|---|---:|---:|
| clientes en el maestro legacy | 988 | **988** |
| sin equivalente en la base | 0 | **0** |

**1.010 clientes en la base**: 943 creados desde el maestro, 7 creados desde la
agenda de contactos, 60 que ya estaban (el histórico de ventas más los tres
demos de Stage 1). 991 conservan su referencia `CLI`.

### Campo por campo, sobre los 988

| | legacy | base |
|---|---:|---:|
| con CUIT | 590 | **559** |
| con al menos un email | 877 | **877** |
| con al menos un dominio | 670 | **670** |
| con nombre comercial | 958 | **958** |
| CUIT distinto al del legacy | 0 | **0** |
| emails del legacy que no están | 0 | **0** |

Los **31 CUIT que faltan** no se perdieron: `tax_id` tiene índice único por
empresa y el maestro legacy repite seis CUIT entre fichas distintas. El que no
se pudo asignar quedó **vacío y marcado**, nunca con el CUIT de otro.

**Rubro: 1.** El legacy tenía un solo rubro real cargado (Grupo Mirgor →
«Gomería / Neumáticos»); los otros tres parches traían `rubro: ""`, que es
ausencia de dato y no se escribió.

### Contactos

| | legacy | base |
|---|---:|---:|
| contactos | 87 | **87** |
| sin `customer_id` | 0 | **0** |
| apuntando a un cliente inexistente | 0 | **0** |

78 se resolvieron por la referencia del propio legacy, 1 por nombre inequívoco
y 8 quedaron enganchados a los 7 clientes que se crearon. **Ninguno** quedó
relacionado por texto: `customer_id` es NOT NULL, así que la relación por
nombre no es una opción que exista.

### Numeración CLI

Serie `CLI`, prefijo `CLI`, padding 5, próximo **1225**, máximo en uso **1224**,
**0 referencias duplicadas**. La da el servidor con `next_document_number`;
no hay `MAX+1` en ningún lado.

### Cola de revisión: 40 clientes

| motivo | clientes |
|---|---:|
| `CUIT_REPETIDO_EN_LEGACY` | 31 |
| `CUIT_NO_ASIGNADO` | 27 |
| `SOLO_EN_CONTACTOS` | 7 |
| `VARIOS_LEGACY_AL_MISMO_CLIENTE` | 3 |

Un cliente puede tener más de un motivo. La ficha los explica en castellano y
el listado tiene un filtro para trabajarlos.

**No se declara «100 %»**: hay 40 casos que necesitan criterio humano.

---

## Decisiones que hubo que tomar

### Los 7 clientes que sólo existían en la agenda de contactos

Selplast SA, Herrajes Roma, Alutek, ECOWAY, Mafersa S.A.I.C., CIAL DNB y MACSI.
No están en el maestro ni en el histórico de ventas: el único rastro es que
alguien cargó un contacto suyo. Los siete tienen **nombre propio y dominio de
correo propio** —no un gmail—, que es identidad suficiente, así que se
crearon y sus 8 contactos quedaron enganchados. Van marcados
`SOLO_EN_CONTACTOS` para que alguien confirme quiénes son.

Eran 13 en la auditoría. Con el maestro completo migrado, 6 de esos nombres ya
tenían cliente.

### Tres clientes duplicados que hubo que borrar

La primera corrida del enriquecimiento falló a mitad de camino (`email_domains`
es NOT NULL y el alta pasaba `null`). Alcanzó a escribir `legacy_ref`, `tax_id`
y `emails` en 45 clientes. En el reintento, esos datos nuevos hicieron que una
**segunda** ficha del legacy reclamara al mismo cliente por dominio, y la regla
«si dos legacy reclaman al mismo cliente, no se fusiona ninguno» desarmó tres
cruces que eran exactos. Resultado: NEWSAN SA - MOTOS, Orbis Merting y Aceitera
General Deheza quedaron duplicados.

Se corrigieron las dos cosas:

1. **La regla.** Si entre los que reclaman hay **uno solo** que coincide por
   referencia legacy o por CUIT exacto, ése gana; los demás se marcan y se
   crean aparte. La evidencia dura no la desplaza un parecido de dominio.
   Sin esto el resultado ni siquiera era estable entre corridas.
2. **Los datos.** Las tres filas duplicadas se borraron —creadas minutos antes,
   sin un solo documento, contacto ni dirección colgando— y el cliente
   original conservó su enriquecimiento.

Después de eso, la corrida es **idempotente**: 988 cruzan por referencia, 0 a
crear, 0 a enriquecer, 0 conflictos.

### El normalizador de nombres

`Madexa S.A` y `MADEXA SA` son el mismo cliente, pero la puntuación dejaba uno
como `madexa s a` y el otro como `madexa sa`, y la forma societaria sólo se
reconocía en el segundo. Ahora las letras sueltas se juntan antes de sacar la
forma societaria: una letra sola dentro del nombre de una empresa siempre es
una inicial. Es determinístico, no es *fuzzy*.

---

## La pantalla

`#/clientes` — listado

- **Todo del lado del servidor**: filtros, orden, página y el total exacto.
  El legacy tenía los 988 en memoria y filtraba con `_clientes_applyFilters`
  sobre el array entero para mostrar 25.
- **Los filtros viven en la URL**, así que un listado filtrado es un link que
  se comparte y el botón «atrás» deshace el filtro.
- Búsqueda libre sobre nombre, nombre comercial, referencia, CUIT (con guiones
  o sin ellos), email y dominio; filtro por rubro; filtro de cola de revisión;
  y las bajas ocultas salvo que se pidan.
- Orden por Referencia, Nombre jurídico, CUIT y Rubro, con desempate estable
  —sin él, dos clientes sin rubro pueden cambiar de lugar entre páginas y una
  fila sale dos veces o ninguna.
- Exportar a CSV: con selección exporta lo seleccionado; sin selección exporta
  **lo que muestran los filtros**, pidiendo páginas al servidor.
- Tabla en escritorio, tarjetas en mobile.

`#/clientes/<uuid>` — ficha, cuatro pestañas

| pestaña | qué muestra |
|---|---|
| **Información** | identificación, emails, dominios, rubro, teléfono, condición de pago, vendedor. Lo que falta se ve como faltante, en cursiva, no como vacío |
| **Contactos** | los del cliente, por FK real |
| **Historial** | cotizaciones, pedidos y notas de entrega, con **totales por moneda** |
| **Relacionados** | direcciones, alias de producto y candidatos de orden de compra |

Arriba, si el cliente está marcado, un aviso que **no se puede cerrar** con el
motivo explicado en castellano: es lo que explica por qué un CUIT está vacío o
por qué hay dos clientes parecidos.

El identificador de la URL es el **uuid**, no la referencia `CLI00001`: la
referencia es un dato del cliente —heredado, editable, y que 19 de los 1.010 no
tienen—, no su identidad.

### Diferencias con el legacy, a propósito

| legacy | acá | por qué |
|---|---|---|
| totales del cliente en **un solo importe** | **por moneda**, sin convertir | sumar ARS + USD + EUR no significa nada. El histórico tiene 4 monedas |
| documentos del cliente cruzados por **nombre normalizado** | por `customer_id` | corregir una tilde borraba media historia |
| contactos relacionados por el **nombre** del cliente | `customer_id` NOT NULL | renombrar el cliente dejaba sus contactos colgando |
| paginado de 25 **en el cliente** | server-side | 988 clientes en memoria por pantalla |
| filtros en `state.clientesFilters` | en la URL | se perdían al navegar o recargar |
| un email por cliente | `emails text[]`, todos | el legacy perdía los demás; el CSV los vuelca todos |
| pestaña **Memoria de precios** | no está | el legacy la guardaba en `localStorage`. El precio que vale es el de cada cotización: se deriva de `sales_quote_lines`, no de una copia paralela |
| pestaña **Memoria de productos** | sólo lectura, dentro de Relacionados | la pantalla completa es la entrega 4 |

---

## Tests

**Unitarios** — 34 nuevos, 213 en total, todos en verde.

- `totalesPorMoneda`: no suma monedas distintas, agrupa aparte las que faltan,
  cuenta el documento aunque su total sea nulo
- filtros ↔ URL, ida y vuelta, con valores inventados que caen al defecto
- formato de importe, fecha y CUIT
- CSV: escape, todos los emails, motivos de revisión

**Contra los datos reales** — `scripts/fase5-clientes-tests.mjs`, sesión real,
0 fallos. Prueba las mismas consultas que hacen los services:

- listado: total del servidor, 25 filas por página, la página 2 no repite, el
  orden se invierte, la misma página dos veces da lo mismo
- búsqueda: por nombre, CUIT con y sin guiones, referencia, email, dominio; un
  texto inexistente da 0 y no un error; una coma no rompe el `or` de PostgREST
- cola de revisión: 40, y ninguna fila sin marcar se cuela
- ficha: se lee, 22 contactos por FK, 236 documentos, totales por moneda sin
  mezclar, relacionados legibles, un id inexistente devuelve `null`
- RLS con un rol externo: ve **una** ficha —la suya—, no lee la ficha ni los
  contactos de otro, y **no puede crear un cliente** (42501). Probado con un
  intento real, no contando filas.

**Regresión de Ventas** — las siete suites en verde, 288 / 166 / 182 / 636
documentos y la huella `8091b9166350c5bf2c331b1d882ec654` **sin cambios**.

Dos suites necesitaban un arreglo, ninguna por un problema de datos:

- `stage1-ventas-tests`: las 40 llamadas concurrentes a `next_document_number`
  fallaban de a ratos con `TypeError: fetch failed` —cuarenta conexiones
  simultáneas desde una máquina de escritorio, sin respuesta ni código de error
  de Postgres. Ahora se reintenta el transporte; lo que se mide sigue siendo
  estricto: 40 números, todos distintos y sin huecos.
- `stage1-ventas-rls`: la limpieza comparaba contra `document_sequences = 6`
  fijo. Clientes sumó la serie `CLI`. Ahora compara contra el estado previo.

---

## Lo que queda para la entrega 3 y siguientes

- **Alta y edición** de cliente, contactos y direcciones. Numeración desde el
  servidor y borrado lógico: `app.proteger_borrado_cliente()` ya rechaza el
  DELETE físico de un cliente con documentos.
- **Los 40 marcados** hay que trabajarlos a mano. La pantalla los filtra y el
  CSV los exporta con su motivo.
- **Memoria de productos** (entrega 4), sobre las 14 filas de
  `customer_product_aliases`.
- **Memoria de precios** derivada de `sales_quote_lines` /
  `sales_order_lines`. `BTERP_PRICE_MEMORY` no se migra: no es fuente maestra.
- **Rubros y catálogos**: el legacy configura cuatro rubros con sus catálogos y
  hoy hay **un** rubro real cargado. Hay que ver qué funcionalidad tiene de
  verdad antes de migrar una taxonomía.
- **Clientes potenciales**: `NOT_MIGRATED_BY_DESIGN` — es un CRM de leads, no
  un maestro de clientes.
- **Vendedor, condición de pago, lista de precios y direcciones estructuradas**
  siguen vacíos: el legacy no los tenía por cliente y no se inventan.
