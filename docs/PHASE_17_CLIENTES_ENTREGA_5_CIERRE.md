# Fase 17 · Clientes · Entrega 5 — Cierre: alta atómica, duplicados y revisión

Fecha: 2026-09-18. Proyecto: `uaxcfufvapzulqvynanp`.
SQL: [`docs/database/PHASE_17_CLIENTES_ENTREGA_5.sql`](database/PHASE_17_CLIENTES_ENTREGA_5.sql),
con su ROLLBACK.

E5 cierra el módulo: el alta pasó a ser una transacción, los duplicados se detectan **antes** de
crear, y los 40 clientes que la migración marcó tienen por fin un lugar donde revisarse.

**0 tablas nuevas, 0 columnas nuevas.** Un índice, dos funciones nuevas y una endurecida.

---

## 1 · Auditoría previa

| Clave | Cómo estaba |
|---|---|
| CURRENT_REVIEW_QUEUE | **No había cola.** Un filtro `revision=1` en el listado, un badge por fila, y en la ficha un botón «Dar por revisado» por motivo. |
| CURRENT_REVIEW_REASONS | Cinco combinaciones, todas del importador: `CUIT_REPETIDO_EN_LEGACY \| CUIT_NO_ASIGNADO` (26), `SOLO_EN_CONTACTOS` (7), `CUIT_REPETIDO_EN_LEGACY` (4), `VARIOS_LEGACY_AL_MISMO_CLIENTE` (2), las tres juntas (1). `lib/motivos.ts` ya las traducía todas. |
| CURRENT_DUPLICATE_HANDLING | Sólo el índice único de CUIT, que salta **después** de intentar el insert. Cero detección previa. |
| CURRENT_CREATE_FLOW | Dos viajes: `next_document_number` y después el `insert`. **La referencia se perdía** si el insert fallaba, el alta **no mandaba vendedor ni tarifa**, y no había contacto ni dirección. |
| DUPLICATE_SIGNALS_AVAILABLE | Mejores de lo esperado: `pg_trgm` ya instalada y con índices GIN en `legal_name` y `trade_name`, GIN en `emails` y `email_domains`, el único parcial de CUIT normalizado y `idx_customers_review`. Faltaba sólo el del teléfono. |

Dos hallazgos que cambiaron el plan: **`customers` no tiene `external_id`** —la identidad externa es
`legacy_ref` + `legacy_source` + `imported_at`— y **no existe ningún badge numérico en la navegación**
del ERP, así que por § 23 no se inventó uno.

Y uno que el modelo ya tenía bien: `app.revisar_motivos_cliente` **resuelve solo** los motivos
verificables cuando llega el dato —cargar el CUIT hace caer `CUIT_NO_ASIGNADO`— y conserva los que
necesitan que alguien mire. Eso no se tocó.

## 2 · El alta, en una transacción

`ATOMIC_CREATE_RPC` = `crear_cliente(p_company, p_datos, p_contacto, p_direccion)`.

`CREATE_FLOW`: el cliente, su primer contacto y su primera dirección entran **juntos o no entra
nada**. Un cliente creado a medias —sin el contacto que la persona escribió— es peor que un error.

La referencia `CLI00001` sigue saliendo de `next_document_number`, el mismo mecanismo que numera
cotizaciones, pedidos y remitos; lo que cambió es **dónde** se llama. Adentro de la transacción, un
fallo posterior devuelve el contador atrás y **no deja hueco**. Probado midiendo el contador antes y
después de seis altas rechazadas.

`INITIAL_CONTACT` / `INITIAL_ADDRESS`: opcionales. Se puede crear sólo el cliente, o con contacto, o
con dirección, o los tres. Si viene, el contacto nace **principal** y la dirección **principal de su
tipo** — y eso es seguro porque son los primeros: no hay otro al que pisarle la marca. **Esta regla
vale sólo en el alta**: a los 87 contactos que ya existen no se les marca ninguno solo.

`TRANSACTION_ROLLBACK`: probado en los dos sentidos que pide el pedido —contacto inválido y dirección
inválida— más razón social vacía, CUIT de diez dígitos y vendedor de otra empresa. Ninguno de los
seis dejó un cliente, ni una referencia consumida, ni un contacto o una dirección sueltos.

`AUDIT`: **un** evento `created`, no tres. El alta es un solo acto aunque escriba en tres tablas; el
trigger de E1 ya registraba el evento y E5 lo completa con la referencia, el contacto y la dirección
que se crearon junto. Agregar dos eventos más diría lo mismo con menos contexto.

## 3 · Duplicados: proponer, no decidir

`DUPLICATE_DETECTION` = `clientes_similares(...)`, `security invoker`.

`DUPLICATE_SIGNALS`:

| Fuerza | Señal | Qué hace la pantalla |
|---|---|---|
| **fuerte** | mismo CUIT normalizado | **Bloquea.** No lo decide el panel: lo decide el índice único, porque dos clientes no tienen el mismo CUIT. |
| media | mismo email · mismo teléfono | Avisa. Pasa de verdad —hay 10 grupos que comparten email en producción— y no siempre es un duplicado: una casa matriz y su sucursal comparten la casilla de compras. |
| débil | nombre parecido | Avisa. **Nunca** bloquea. |

**AUTOMATIC_MERGE = NO.** En ningún lado hay un botón de fusionar, y hay una prueba que lo verifica.

El umbral del parecido está **medido, no elegido a ojo**. Con `similarity` sola a 0.45, el ejemplo del
propio pedido —«Metalúrgica ABC» vs «Metalurgica A.B.C.», que da **0.417**— no aparecía, y «Mirgor SA»
contra «Grupo Mirgor S.A.» (0.421) tampoco. Se usan las dos métricas de `pg_trgm` porque miden cosas
distintas: `similarity` («son el mismo nombre escrito distinto») y `word_similarity` («lo que escribí
está dentro del nombre existente»: *Whirlpool* → *WHIRLPOOL ARGENTINA S.A.*, 1.000). Con
`similarity >= 0.4 or word_similarity >= 0.7`, seis nombres de prueba contra los 1.010 clientes
devuelven entre 1 y 5 candidatos cada uno.

`DUPLICATE_CUIT_PROTECTION`: la pantalla apaga «Crear cliente» y explica dónde está el que ya existe;
el servidor rechaza igual con `CLIENTE_DUPLICADO`. **CONCURRENT_CREATE**: dos altas simultáneas con el
mismo CUIT — entra una, la otra recibe el mensaje en castellano y no el error crudo de Postgres.
Probado lanzando las dos a la vez.

## 4 · La cola de revisión

`REVIEW_QUEUE` = `/clientes/revisar`, paginada del lado del servidor.

Cada cliente muestra su nombre, su referencia, si vino migrado, y **cada motivo en castellano** con su
propio botón «Dar por revisado». Las dos únicas acciones son las que corresponden: **abrir el cliente y
mirar**, o dar un motivo por revisado. No fusiona, no borra, no reasigna documentos.

`REVIEW_RESOLUTION`: `resolver_revision_cliente` conserva su lógica y gana tres cosas —**auditoría**
(qué motivo se resolvió, quién y cuándo), el contrato de **`sin_cambios`** del resto del módulo, y la
lista de resueltos en la respuesta—. El motivo se conserva en la auditoría **aunque se borre de la
ficha**: para eso está.

`IMPORTADOS`: dar por revisado **no toca** `legacy_ref`, `legacy_source` ni `imported_at`. Un cliente
migrado sigue siendo migrado después de revisarlo, y hay una prueba que lo verifica campo por campo.
`REVIEW_REASON` no se migró ni se reclasificó: se muestra tal como está, traducido por el mapa que ya
existía.

`PRIMARY_CONTACT_WARNING`: en la pestaña de contactos, si hay contactos activos y ninguno es el
principal, se dice —«Este cliente no tiene un contacto principal»— con la instrucción de cómo
marcarlo. **No se marca ninguno solo**: quién atiende a cada cliente no lo sabe una migración.

## 5 · Lo que queda fuera, con su motivo

`DISCOUNT_PCT_DECISION` = **fuera**. `CREDIT_LIMIT_DECISION` = **fuera**.

No es prudencia: es que **no hay dato**. Los dos campos están en `customers` desde Stage 1 y **cero de
los 1.010 clientes** tiene un valor distinto de cero en cualquiera de los dos. Ningún código los lee.
No hay regla escrita que diga si `discount_pct` es un descuento de cabecera o por línea, ni qué
tendría que hacer `credit_limit` cuando se supera. Sin datos y sin regla no hay nada que inferir, y
una regla de crédito inventada es una forma de romper ventas.

`CUSTOMER_MERGE_GAP` = **futuro, a propósito**. Fusionar dos clientes toca documentos, contactos,
direcciones, adjuntos, precios históricos, memoria de productos, auditoría e identidad importada.
Media fusión es peor que ninguna, así que E5 no la implementa ni la insinúa con un botón.

## 6 · Seguridad

`PERMISSIONS` / `RLS`: dar de alta es admin, employee o salesperson —los mismos de `customers_insert`—;
resolver revisiones es admin o employee. Las tres funciones tienen `anon` revocado.

`DUPLICATE_SEARCH_SECURITY` (§ 35): `clientes_similares` es `security invoker`, así que **hereda
`customers_select`**. Probado: el vendedor encuentra por CUIT el cliente que tiene asignado y **no**
encuentra uno que no es suyo —ni por CUIT ni por email—; el técnico no encuentra ninguno; el admin de
otra empresa tampoco; anónimo ni puede llamarla. Buscar duplicados no es una puerta trasera al
maestro.

`RED_TEAM`: se intentó inyectar **catorce** campos en el alta —`company_id`, `id`, `legacy_ref`,
`needs_review`, `review_reason`, `imported_at`, `legacy_source`, `status`, `deleted_at`, `created_at`,
`updated_at`, `created_by`, `discount_pct`, `credit_limit`— más uno en el contacto y otro en la
dirección. Los dieciséis rechazados con `CAMPO_NO_EDITABLE`.

`PERFORMANCE`: la búsqueda usa los índices que ya existían más uno nuevo para el teléfono; nunca
recorre el maestro en el navegador. No sale hasta que hay con qué buscar —CUIT completo, email,
teléfono de seis dígitos o cuatro letras de nombre— y espera 400 ms a que dejen de escribir. La cola
de revisión pagina del lado del servidor.

## 7 · Pruebas

| Suite | Resultado |
|---|---|
| `scripts/fase17-e5-clientes-cierre-tests.mjs` (base real) | **83 PASS · 0 fallos** |
| `fase17-e1`, `e2`, `e3`, `e4` y `fase15-e4`, `e5`, `e6` (regresión) | 0 fallos |
| `npm test` / `npm run test:isolated` | **1.569 tests**, 133 archivos |
| `npx tsc -b`, `npm run lint`, `npm run build` | limpio |

Del frontend: 16 pruebas del alta —incluida «destildar el contacto lo saca del alta aunque esté
escrito» y «en ningún caso se ofrece fusionar»— y 10 de la cola.

Dos fallos de la suite de base fueron **míos, no del código**: pedía que el vendedor no viera un
cliente que en el fixture tenía asignado —o sea, que sí podía ver—, y esperaba un evento de auditoría
donde correspondían dos. Los dos arreglados en el test, que ahora prueba lo que dice probar.

## 8 · Verificación en el navegador

Con datos reales y **sin resolver ninguna revisión ni crear ningún cliente**:

- **`/clientes/revisar`**: los 40 clientes reales, `1–25 de 40`, cada motivo en castellano —«No estaba
  en el maestro de clientes: apareció al cargar un contacto suyo»— y un solo `h1`.
- **Alta con «Metalurgica A.B.C.»**: encuentra **6 clientes parecidos** de verdad (Bianchi, Fredizzi,
  Gentili, Giraldes, Santa Ana, IMSA), en un aviso `role="status"` y con «Crear cliente» **habilitado**.
- **Alta con el CUIT de Grupo Mirgor**: «Ya existe un cliente con este CUIT», «No se puede crear» y el
  botón **apagado**.

Sin desborde horizontal a 375 px. Consola limpia en una pestaña nueva. Producción idéntica: 1.010
clientes, 40 para revisar, 87 contactos, 0 direcciones, 0 adjuntos, 0 empresas `zz`.

## 9 · Qué queda del módulo Clientes

- **`CUSTOMER_MERGE`** — el gap grande, descrito arriba.
- **`discount_pct` y `credit_limit`** — esperando una decisión de negocio, no código.
- **Marcar los contactos principales en producción** — 87 contactos, ninguno principal. Ahora la
  pantalla lo pide donde se puede arreglar.
- **Cuatro `PanelAdjuntos`** — Ventas, Compras, Mantenimiento y Clientes tienen cada uno el suyo sobre
  la misma tabla y el mismo bucket (viene de E4).
