# Fase 23 · Auditoría global de paridad — HTML legacy → React

**Esta fase es de sólo lectura.** No se implementó ninguna funcionalidad
faltante, no se tocó producción, no se cambió el esquema, ni RLS, ni una RPC.

---

## 1. Qué se leyó

| fuente | qué |
|---|---|
| `github.com/buscatoolsjano-web/Buscatools` | clonado, commit `e074e79` (2026-09-08) |
| `app.js` | **45.345 líneas**, leídas programáticamente |
| `index.html` | 3.534 líneas |
| `productos-data.json` | 15,6 MB (los datos, no funcionalidad) |
| `index_files/` | `html2pdf`, `pdf.min.js`, `firebase-app-compat`, `firebase-database-compat`, `gridstack`, `supabase-js@2` |
| repo React | **809 archivos**, 677 de código, 161 de test |

```
LEGACY_FILES_ANALYZED  = 9 archivos propios + 12 dependencias en index_files
LEGACY_APP_JS_ANALYZED = YES  (extracción programática, no lectura a ojo)
LEGACY_UI_REAL_SESSION = NO   (ver «Lo que no pude comprobar»)
REACT_FILES_ANALYZED   = 809
REACT_REAL_SESSION     = YES  (servidor de desarrollo, catálogo y ficha)
```

La extracción es reproducible:

```bash
node scripts/audit/fase23-inventario-legacy.mjs <ruta-al-legacy>
node scripts/audit/fase23-capacidades-legacy.mjs <ruta-al-legacy>
node scripts/audit/fase23-inventario-react.mjs
node scripts/audit/fase23-matriz.mjs --csv docs/PHASE_23_PARITY_MATRIX.csv
```

### Lo que el código dice y la pantalla no

| | legacy | React |
|---|---|---|
| funciones de primer nivel | 1.159 | — |
| pantallas (`render*`) | 110 | 55 páginas |
| cableados de eventos (`wire*`) | 49 | — |
| secciones del router | **19** | **10 módulos** |
| claves de `localStorage` | **62** | 2 |
| tablas de Supabase | 10 | ~40 |
| RPC de Supabase | 8 | **98** |
| sitios de impresión | 17 | 4 hojas con `@media print` |
| sitios de exportación | 52 señales · 11 descargas distintas | 29 archivos con CSV |
| atributos `data-*` de acción | 626 candidatos | — |

La asimetría de `localStorage` (62 contra 2) y de RPC (8 contra 98) es el
resumen de la migración: **el legacy es una aplicación de navegador con la
base como archivo; React es una aplicación con la lógica en la base.**

---

## 2. El número

```
TOTAL_ACTIVE_LEGACY_CAPABILITIES = 251
LEGACY_DEAD_CODE                 =   3   (no se exige paridad)

PARITY                  = 133
PARTIAL                 =  21
MISSING                 =  72
INTENTIONALLY_DIFFERENT =  23
UNKNOWN                 =   2
```

Dos porcentajes, y los dos honestos (§21):

```
GLOBAL_PARITY_PERCENT (estricto)   = 53,0 %   PARITY / activas
GLOBAL_PARITY_PERCENT (cubierto)   = 62,2 %   (PARITY + INT.DIF) / activas
```

El primero cuenta sólo lo que hace exactamente lo mismo. El segundo suma lo
que React resuelve de otra manera pero con la misma capacidad para el usuario
—Supabase Auth en vez de contraseñas en `localStorage`, RLS en vez de
`display:none`—. **`PARTIAL` no está escondido dentro de ninguno de los dos.**

### Por módulo

| módulo | activas | PARITY | PARTIAL | MISSING | INT.DIF | UNKNOWN | % estricto |
|---|---:|---:|---:|---:|---:|---:|---:|
| CLIENTES | 22 | 18 | 0 | 3 | 1 | 0 | 82 % |
| STOCK | 12 | 9 | 0 | 0 | 2 | 1 | 75 % |
| COMPRAS | 17 | 14 | 0 | 3 | 0 | 0 | 82 % |
| CONFIGURACION | 15 | 11 | 2 | 0 | 2 | 0 | 73 % |
| VENTAS | 55 | 38 | 5 | 11 | 1 | 0 | 69 % |
| INFORMES | 12 | 8 | 0 | 2 | 2 | 0 | 67 % |
| EMAILS | 16 | 10 | 1 | 2 | 3 | 0 | 63 % |
| MANTENIMIENTO | 18 | 7 | 4 | 4 | 3 | 0 | 39 % |
| GLOBAL_SHELL | 18 | 6 | 2 | 4 | 6 | 0 | 33 % |
| DASHBOARD | 12 | 5 | 2 | 5 | 0 | 0 | 42 % |
| CATALOGO | 15 | 4 | 3 | 8 | 0 | 0 | 27 % |
| **OTROS** | **39** | **3** | **2** | **30** | **3** | **1** | **8 %** |

`OTROS` son los módulos que **sólo existen en el legacy**: facturación de
venta, CRM, finanzas, agenda, importación, conexiones, chat, portal del
cliente e IA. Es donde está el 42 % de todo lo que falta.

`CATALOGO` tiene 27 % acá pero eso no contradice a F22: en esta matriz el
catálogo aparece con 15 filas agrupadas, y la fila `CA-01` referencia las 57
capacidades que F22 auditó una por una (32 PARITY allá). Contarlas dos veces
inflaría el total.

---

## 3. Los gaps

```
BLOCKERS = 5
HIGH     = 20
MEDIUM   = 37
LOW      = 31
```

### TOP_BLOCKERS

| id | capacidad | por qué bloquea |
|---|---|---|
| `FA-01` `FA-02` `FA-03` | **Facturar una venta**: listar, crear/editar e imprimir facturas | El ciclo comercial termina en el remito. Sin factura no se cobra, y no hay ninguna otra pantalla donde hacerlo |
| `VE-50` | Generar la factura desde el remito | Es el paso que une Ventas con Facturación. Existe el botón en el legacy (`#ne-gen-factura`) y no tiene destino en React |
| `CA-02` | Agregar al carrito desde el catálogo | Es **el** camino por el que nace una cotización en el legacy: stepper por fila, barra flotante con total, «Ver cotización». En React hay que abrir una cotización y buscar cada producto adentro |

### TOP_HIGH_GAPS

| id | capacidad |
|---|---|
| `FI-01` | Tipo de cambio — los documentos en moneda extranjera dependen de él |
| `FI-02` | Aging de cuentas por cobrar |
| `FA-04` `FA-05` `FA-06` | Exportar facturas · recibos de cobro · notas de crédito |
| `VE-15` `CO-10` | **Enviar el documento por mail** — existe en cotización, pedido, remito, factura y pedido de compra |
| `VE-51` | Importar la OC del cliente desde un PDF, con creación del producto faltante |
| `CL-17` | Memoria de alias del cliente: texto de la OC → SKU |
| `PC-01` `PC-02` `PC-03` | Portal del cliente: catálogo público, armar cotización, enviar solicitud |
| `SH-04` | Entrar sin sesión (visitante) |
| `DA-10` | Ver las solicitudes web pendientes |
| `CA-03` `CA-07` `CA-08` | Exportar el catálogo · crear producto · editar producto |
| `PC-05` | Cuentas de cliente (React tiene los roles, no la pantalla) |

---

## 4. Flujos end-to-end

| flujo | legacy | React | gap |
|---|---|---|---|
| `FLOW_01` cliente → cotización | COMPLETO | COMPLETO | El legacy tiene un atajo que React no: armar el carrito desde el catálogo (`CA-02`). El flujo se completa igual, con más pasos |
| `FLOW_02` cotización → pedido | COMPLETO | COMPLETO | — |
| `FLOW_03` pedido → remito | COMPLETO | COMPLETO | React agrega la entrega parcial con control de autoridad |
| `FLOW_04` producto → comparación técnica | COMPLETO | **PARCIAL** | No se pueden elegir 2–4 productos cualesquiera (`CA-04`) |
| `FLOW_05` cliente → historial comercial | COMPLETO | COMPLETO | React sobrepasa (360, precios históricos) |
| `FLOW_06` producto → stock | COMPLETO | COMPLETO | — |
| `FLOW_07` mantenimiento → activo → historial | COMPLETO | COMPLETO | — |
| `FLOW_08` email → lectura/respuesta | COMPLETO | COMPLETO | Faltan etiquetas y reglas (`EM-10`, `EM-11`) |
| `FLOW_09` informe → drill-down → documento | **PARCIAL** | COMPLETO | El legacy navega a la sección; React abre los documentos exactos del KPI (F21 · E3, 18/18 reconciliados) |
| `FLOW_10` configuración → cambio → efecto | COMPLETO | COMPLETO | — |

**Un flujo que la lista no pedía y que conviene agregar:**

| flujo | legacy | React | gap |
|---|---|---|---|
| `FLOW_11` remito → factura → cobro | COMPLETO | **ROTO** | No existe facturación. Es el bloqueante real |

---

## 5. Impresión (§12)

**Legacy — 17 sitios.** Un motor propio: arma el HTML del documento, lo mete
en un iframe y llama a `window.print()` (`app.js:25881`), o abre una ventana
(`:25888`). Para PDF usa `html2pdf` (`:25910`) y si la librería no cargó,
cae a `window.print()` (`:25895`). CSS de impresión en `:25291`, `:25573`,
`:25574`. Opciones guardadas en `erp_print_opts`.

**React — 4 hojas con `@media print`:** `ventas/VistaImpresion`,
`ventas/VistaPreviaBorrador`, `compras/VistaImpresionCompras`, `global.css`.

| documento | legacy | React |
|---|---|---|
| Cotización | ✓ imprimir + PDF | ✓ imprimir (`ModalImpresion`) |
| Pedido | ✓ imprimir + PDF | ✓ |
| Remito | ✓ imprimir + PDF | ✓ |
| Pedido de compra | ✓ imprimir + PDF | ✓ |
| **Factura de venta** | ✓ | **no existe el documento** |
| **Recibo / Nota de crédito** | ✓ | **no existe el documento** |

**La diferencia que importa no es el motor, es el archivo.** El legacy
**genera** el PDF con `html2pdf` y lo descarga; React abre el diálogo del
navegador y el usuario elige «Guardar como PDF». Para mandar el archivo por
mail —que es lo que se hace después— no es lo mismo (`VE-14`, MEDIUM).

---

## 6. Exportaciones (§13)

**Legacy — 11 descargas distintas**, todas construidas con `Blob` + `a.download`:

| qué | dónde | React |
|---|---|---|
| catálogo (27 columnas a elegir, alcance filtrado/todo) | `app.js:17010` | **falta** (`CA-03`) |
| clientes | `:18475` | ✓ `clientes/lib/csv.ts` |
| memoria de alias del cliente (JSON) | `:18998` | **falta** (`CL-18`) |
| cotizaciones | `:19585` | ✓ `ventas/lib/csv.ts` |
| documento (CSV genérico) | `:24220` | ✓ |
| adjunto | `:24867` | ✓ |
| documentos relacionados | `:25016` | **falta** (`VE-37`) |
| archivo de la biblioteca | `:26663` | **falta** (`IN-11`) |
| facturas de venta | `:27313` | **falta** (`FA-04`) |
| recibos | `:27776` | **falta** (`FA-05`) |
| notas de crédito | `:27876` | **falta** (`FA-06`) |
| mantenimiento: histórico, actividad, clientes, nuevos, backup JSON | `:30340` | parcial (`MA-13`, `MA-14`) |

**Portapapeles:** 0 usos en el legacy. No hay nada que replicar.

---

## 7. Búsquedas (§14)

| búsqueda | legacy | React |
|---|---|---|
| productos (catálogo) | `includes` sobre sku+nombre+base+marca, en memoria sobre 21.775 | `search_products`: tsvector español + trigram, umbral 0,4, en el servidor |
| productos (dentro del documento) | `renderAddProdResults` `:21908` — mismo `includes` | `productosParaLinea.ts` → `search_products`, límite 20 |
| clientes | filtro de texto del listado | `clientes_similares` |
| cliente (dentro del documento) | `#cot-cli-drop` autocompletado | `EditorCabecera` + `clientes_similares` |
| documentos | filtros por columna (ref, cliente, título, estado) | `ListadoDocumentos` con los mismos filtros |
| emails | filtros de la lista | `listar_bandeja_email` |
| destinatarios de email | no existe | `autocompletar_destinatarios_email` (REACT_ONLY) |
| global (toda la app) | **no existe** | **no existe** |

**Mínimo de caracteres:** el legacy no exige ninguno y filtra en memoria;
React exige 2 en el buscador de productos del documento
(`productosParaLinea.ts`). Es una diferencia de implementación, no de
capacidad: el legacy puede permitírselo porque tiene los 21.775 productos en
un array.

---

## 8. Roles (§16)

**Los padrones no son el mismo.**

| legacy | cómo se decide | React |
|---|---|---|
| `VISITANTE` (sin usuario) | `getPermsFor(null)` → `catalogo` + `micotizacion` | **no existe**: React exige sesión |
| `ADMIN` | literal `user === 'ADMIN'` + secciones ocultas hardcodeadas | `admin` |
| `cliente` | `role === 'cliente'` en `erp_auth_users` | `customer`, `distributor` |
| equipo (implícito) | cualquier usuario sin permisos definidos: **todo habilitado** | `employee`, `salesperson`, `technician` |

```
ROLE_PARITY = PARCIAL
```

Tres diferencias concretas:

1. **El visitante no existe en React.** Es la raíz de `SH-04`, `PC-01`…`PC-05`
   y `DA-10`: el catálogo público y el portal del cliente.
2. **El legacy da permiso por sección y por usuario** (`erp_user_perms`,
   `data-perm-k`); React da un rol. Un usuario legacy puede tener Ventas sí y
   Compras no; en React eso no se puede expresar (`SH-11`, `CF-04`).
3. **React tiene más roles** y los distingue donde el legacy no
   (`salesperson`, `technician`).

```
RLS_DIFFERENCES = el legacy no tiene RLS. Los permisos son display:none sobre
                  datos que YA están en el navegador: el costo y el stock
                  virtual se descargan siempre y se ocultan al dibujar
                  (isCatCliente, isDetCliente, _isCmpCliente, _isClienteExport).
                  En React el dato no sale de la base.

INTENTIONAL_SECURITY_DIFFERENCES = 6
  SH-01  contraseñas en localStorage (erp_auth_users) → Supabase Auth
  SH-03  contraseña autogenerada y mostrada en pantalla → enlace por mail
  SH-10  permisos en el navegador → RLS en Postgres
  CF-14  clave de OpenAI en localStorage (erp_openai_key) → no se replica
  IA-04  la IA con credenciales del navegador → no se replica
  CA-01  precio de venta calculado como `pu * 3` en JS → listas de precio en la base
```

Ninguna de las seis se va a copiar. Todas mantienen la capacidad para el rol
correcto.

---

## 9. Funciones ocultas (§6)

Cosas que el código tiene y la pantalla no anuncia:

| qué | evidencia | cómo se llega |
|---|---|---|
| Pantalla de **estadísticas** | `app.js:5563`; `getPermsFor` la pone en `true` a mano y el comentario dice «invisible e inalcanzable para cualquier otro usuario» | sólo `ADMIN` |
| **Trazabilidad** y **conexiones** | mismo mecanismo, `app.js:1013` | sólo `ADMIN` |
| **Guardia de sección por estado** | `renderMain` re-chequea permisos en cada render «evita acceso por manipulación de estado» | siempre |
| **Atajos de teclado** | 30 apariciones de `e.key ===` / `ctrlKey` / `metaKey` | sin documentar |
| **Arrastrar y soltar** | 53 apariciones (`data-cot-drag`, gridstack, adjuntos) | según pantalla |
| **Menú contextual** | 0 apariciones | no existe |
| **Vista mobile del catálogo** | `mob-prod-card`, `mob-cat-view` | sólo por ancho |
| **Bandera `wa_loggedout`** | `localStorage` | cambia el estado de WhatsApp |
| **`_supaClienteSyncDone`** | `localStorage` | bandera de una migración ya hecha → `DEAD_CODE` |

---

## 10. Código muerto (§7)

Sólo se marcó `DEAD_CODE` lo que se puede justificar:

| qué | por qué |
|---|---|
| `renderDashboardOLD` (`:5578`) y `renderDashboardOLD_OLD` (`:5581`) | el sufijo lo declara y `renderMain` llama a `renderInicio`, no a ellas |
| `renderDocRowRel_OLD` (`:25025`) | ídem; sin referencias |
| `_supaClienteSyncDone` | bandera de una sincronización de una sola vez |

**No se marcó como muerto nada que no se pudiera demostrar.** Hay 1.159
funciones; muchas son auxiliares y no capacidades. La matriz no las cuenta.

---

## 11. Lo que no pude comprobar

```
UNKNOWN = 2
```

| id | qué | cómo se verifica |
|---|---|---|
| `ST-08` | Ajustar existencias a mano | No encontré una pantalla de ajuste en el legacy. Puede que el ajuste se hiciera por otra vía (importación, base). **Preguntarle a Juan.** |
| `IA-06` | Clon conversacional por usuario (`erp_clone_conversations`) | Las tablas existen en Supabase. Hace falta mirar si tienen filas recientes. **Dato necesario:** un `select count(*)` con fecha. |

Y dos límites de esta auditoría que conviene decir:

1. **`LEGACY_UI_REAL_SESSION = NO`.** No abrí la producción del legacy con un
   usuario real. Todo lo del lado legacy sale del código. Para las
   capacidades condicionales por rol (`CN-01`, `CN-02`: Mercado Libre y
   Amazon) eso deja la duda de si están **en uso**, no de si existen.
2. **`CONDITIONAL` no es `ACTIVE`.** Marqué así lo que depende de un rol o de
   un estado. No conté nada de eso como muerto.

---

## 12. Deuda separada (§18)

```
FUNCTIONAL_GAP       = 93   (72 MISSING + 21 PARTIAL)
DATA_QUALITY_GAP     =  4   no son funciones faltantes
TECHNICAL_DEBT       =  3   código muerto del legacy
SECURITY_DIFFERENCE  =  6   deliberadas, ya listadas en §8
```

Los cuatro de calidad de dato, que **no** son gaps funcionales y ya tienen
fase propia:

- 5.509 productos sin marca (F22 · cierre)
- 226 duplicados STEL ↔ catálogo, 88 aprobables (F22 · duplicados)
- 99 equivalencias ambiguas sin resolver (F22)
- APEX inactiva: 3.807 productos fuera del catálogo por decisión

Un producto sin atributos técnicos no es un comparador que falta.

---

## 13. ¿Se puede apagar el legacy hoy?

```
CAN_LEGACY_BE_TURNED_OFF_TODAY = NO
```

**Y no es por el porcentaje.** Es por tres cosas concretas:

```
REASONS_BLOCKING_SHUTDOWN

1. NO SE PUEDE FACTURAR.  (FA-01, FA-02, FA-03, VE-50)
   React llega hasta el remito. La factura de venta, el recibo de cobro y la
   nota de crédito no existen como documento, ni como pantalla, ni como
   tabla. El botón «Generar factura» del remito legacy (#ne-gen-factura) no
   tiene destino en React. Esto solo ya impide apagar el legacy.

2. NO HAY TIPO DE CAMBIO NI CUENTAS POR COBRAR.  (FI-01, FI-02)
   Los documentos en moneda extranjera necesitan una cotización de moneda que
   hoy vive en erp_finanzas_rates. Y no hay forma de ver qué está vencido.

3. EL CLIENTE NO TIENE POR DÓNDE ENTRAR.  (SH-04, PC-01..PC-05, DA-10)
   El catálogo público sin sesión y el portal donde el cliente arma su
   cotización y la manda no existen en React. Si hay clientes usándolo hoy,
   apagar el legacy los deja afuera.
```

Y una advertencia sobre la pregunta inversa: **que falten sólo `LOW` no
alcanzaría para decir que sí.** Quedan dos `UNKNOWN` sin resolver y una
sesión real del legacy sin hacer. Apagar un sistema en producción con dos
preguntas abiertas no es una decisión de porcentaje.

---

## 14. Áreas protegidas (§23)

Lo que ya está completo y **no hay que tocar** al cerrar los gaps:

```
PROTECTED_AREAS

VENTAS (F19)          38/55 PARITY. El editor, la autoridad de numeración, la
                      entrega parcial y la impresión A4 están cerrados y
                      probados (37 archivos de test). Los gaps que quedan son
                      agregados, no correcciones.

INFORMES (F21)        8/12 PARITY + 2 INT.DIF. El drill-down reconcilia exacto
                      con el KPI (18/18) y las funciones de la base son fuente
                      única. Tocar informe_documentos o documentos_comerciales
                      rompe esa garantía.

MANTENIMIENTO (F20)   El histórico STEL separado (opción C) y los 5 pasos de la
                      ficha. Ojo: este módulo tiene 39 % estricto — lo protegido
                      es lo migrado, no el módulo entero.

CATALOGO (F22)        El comparador, las equivalencias bidireccionales y
                      productos_similares. La direccionalidad y el dedupe por
                      producto están medidos; volver a tocarlos sin medir es
                      como empezar.

EMAILS (F9)           El backend en Cloud Run y la sincronización por webhook.

CLIENTES              82 % estricto, el módulo más completo. No hay razón para
                      abrirlo.
```

**Ninguna de estas áreas es perfecta** y la auditoría lo muestra:
Mantenimiento tiene 4 `PARTIAL` y 4 `MISSING`; Ventas, 11 `MISSING`. Estar
protegido significa «no lo rompas mientras cerrás otra cosa», no «está
terminado».

---

## 15. Invariantes

```
DB_CHANGES        = 0
PROD_DATA_CHANGED = 0
PRODUCTS_CHANGED  = 0
STOCK_CHANGED     = 0
STEL_WRITES       = 0
RT_ERP00001       = draft
```

Lo único que se ejecutó contra la base fueron lecturas. El legacy se clonó en
un directorio temporal y no se modificó.

---

## 16. Los otros documentos

| archivo | qué |
|---|---|
| `docs/PHASE_23_PARITY_MATRIX.csv` | las 254 filas, con evidencia y severidad |
| `docs/PHASE_23_LEGACY_ONLY.md` | qué se puede hacer hoy en el HTML y no en React |
| `docs/PHASE_23_REACT_ONLY.md` | lo que React tiene de más (no compensa nada) |
| `docs/PHASE_23_MIGRATION_PLAN.md` | el orden propuesto, agrupado por dependencias |
