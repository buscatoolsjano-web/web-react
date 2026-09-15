# FASE 14 · ENTREGA 0 — APARIENCIA POR USUARIO + COLORES DE MÓDULO + READINESS DEL CUTOVER

> **Ventas productivas NO habilitadas.** Esta entrega agrega la apariencia configurable por usuario
> y la identidad visual de Ventas/Compras/Mantenimiento, y deja clasificada la preparación del
> cutover STEL → ERP con un plan y un rollback. **No se ejecutó el cutover**: la autoridad sigue
> STEL para quote/sales_order/delivery, `AvisoAutoridadStel` sigue, «Nueva cotización» sigue
> deshabilitada en Buscatools, ninguna secuencia productiva se movió y ningún dato productivo se
> corrigió. Auditoría completa: `PHASE_14_ENTREGA_0_AUDITORIA_STEL_VENTAS.md`.
> Commit local, sin push. Fecha: 2026-09-15.

## A. Apariencia por usuario

### A.1 Persistencia (auditoría y diseño)

| Opción evaluada | Resultado |
|---|---|
| `profiles` | Existe, una fila por usuario (trigger `app.handle_new_user`), RLS `profiles_update_own` (id = auth.uid()) y `profiles_select` (propio o compañero). Columna vieja `theme` con CHECK light/dark que **nadie usa**: no alcanza para presets |
| Tabla de preferencias / settings | No existe |
| `user_metadata` de Auth | Viaja en el JWT y lo edita el propio usuario sin validación: descartado |
| Sólo `localStorage` | No sincroniza entre dispositivos: sólo caché |

**Elegido: `profiles.appearance jsonb` + CHECK.** Migración mínima
(`docs/database/PHASE_14_ENTREGA_0_APARIENCIA.sql`, aplicada como
`fase14_e0_apariencia_por_usuario`):

1. columna nullable `appearance` (NULL = original Buscatools; las 7 filas reales quedaron NULL);
2. función pura `app.apariencia_valida(jsonb)`: exactamente 5 claves (`version`, `preset`, `acento`,
   `tamano`, `fuente`), `version = 1`, valores de una lista blanca, ≤ 512 bytes;
3. CHECK `profiles_appearance_valida`.

### A.1b Superficie de escritura de `profiles` (hardening antes del push)

Auditoría (2026-09-15): `authenticated` tenía **todos** los privilegios de tabla sobre `profiles`
(INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) y la política
`profiles_update_own` (id = auth.uid()): cualquier usuario podía cambiar por REST `is_active`,
`full_name`, `deleted_at`, `locale`, `theme`, `phone`, `avatar_path`, `created_at`, `updated_at` de su
perfil. Los escritores legítimos son sólo el trigger de alta `app.handle_new_user` y
`config_registrar_miembro` (ambos SECURITY DEFINER; el segundo sólo `service_role`, vía la Edge
Function de Usuarios). El frontend no escribía `profiles` salvo la apariencia.

Migración `fase14_e0_profiles_escritura_minima`
(`docs/database/PHASE_14_ENTREGA_0_PROFILES_ESCRITURA.sql`, con rollback exacto):

- `authenticated`: **sólo SELECT** sobre `profiles` (`profiles_select` sin cambios); se revoca todo
  lo demás y se elimina `profiles_update_own`.
- Única escritura de un usuario: **`public.guardar_mi_apariencia(p_appearance jsonb)`**, SECURITY
  DEFINER con `search_path` fijo; actualiza **sólo `appearance`** de la fila `auth.uid()`; sin sesión
  → `sin_sesion` (42501). No recibe id, empresa ni otra columna. EXECUTE: `authenticated` (no `anon`).
- `app.apariencia_valida` deja de ser ejecutable por `authenticated` (el CHECK corre como el dueño de
  la función que escribe).
- La app ya no hace UPDATE sobre `profiles`: `guardarApariencia(a)` llama a la RPC con el valor de
  apariencia y nada más.
- `service_role`, el trigger de alta y las RPC de Configuración no cambian.

### A.2 Opciones

| Opción | Valores |
|---|---|
| Tema (17) | Claro naranja (original) · Oscuro naranja · Turquesa marino · Violeta claro · Azul marino · Verde menta claro · Azul cielo oscuro · Azul noche · Azul corporativo · Azul corporativo claro · Gris pizarra oscuro · Verde esmeralda · Azul eléctrico · Verde industrial · Grafito · Naranja oscuro · Cian oscuro |
| Color de acento (8) | Del tema · Naranja · Azul · Turquesa · Verde · Violeta · Rosa · Grafito (cada uno con variante clara y oscura) |
| Tamaño | Compacto (15px; en mobile no baja de 16px) · Normal (16px) · Grande (18px) |
| Tipografía | Sistema · Clásica (Arial/Helvetica) · Serif (Georgia). Sin fuentes externas |
| Restaurar original | Guarda NULL |

Densidad: no se agregó (el tamaño ya escala espaciados porque todo está en `rem`).

### A.3 Presets y AA

Los nombres y la intención visual vienen del ERP HTML; **los hex no se copiaron**: con el texto
blanco que usaba el legacy, 11 de los 17 acentos no llegan a 4,5:1 (p. ej. `#F37021` 2,94:1,
`#00ACC1` 2,74:1, `#10B981` 2,54:1, `#38BDF8` 2,14:1), y el grafito `#64748B` sobre `#0F172A` da
3,75:1. En los claros se oscureció el tono; en los oscuros se aclaró y el texto del botón pasó a oscuro.

- Claros: sólo cambian acento y header; superficies y estados son los de la paleta original.
- Oscuros: paleta completa (fondo, superficies, bordes, texto, header, sidebar, acento) y estados
  con la misma semántica en luminosidad oscura; botón primario claro con texto oscuro; peligro
  claro con `--color-on-danger` oscuro.
- **Dark mode aprobado como presets del mismo sistema**: no hay un segundo sistema. Se eliminó el
  bloque «tema oscuro legacy» que sólo cubría alias viejos.

`tokens.test.ts` simula la cascada de **17 presets × 8 acentos × 4 contextos (sin módulo, Ventas,
Compras, Mantenimiento) = 544 combinaciones** y mide 29 pares de texto (≥ 4,5: texto/fondos, muted,
primario, peligro, estados soft, header, marca) y 4 de UI (≥ 3: borde de controles, primario sobre
superficie y fondo, foco del header) más el indicador activo cuando hay acento o módulo: **0 fallas**.
Probado con una mutación deliberada (texto muted oscuro a `#555555` → el test falla con 4 pares).

### A.4 Aplicación

- `src/features/apariencia/opciones.ts` traduce la preferencia a atributos del `<html>`:
  `data-theme` (light/dark), `data-apariencia`, `data-acento`, `data-tamano`, `data-fuente`.
- `src/styles/tokens.css` capa 3: bloques de tokens por atributo. **Ningún CSS de módulo se editó
  para los temas**; los 95 CSS Modules siguen leyendo `--color-*` y los alias de la capa 2.
- Ajustes de tokens para que los temas oscuros funcionen: `--color-on-danger` (botón de peligro),
  `--color-topnav-focus` (foco en el header), `--color-logo-plate` (placa blanca fija detrás del logo
  PNG oficial), `--color-on-brand` (iniciales del avatar), `--color-indicator` (barra de navegación
  activa), `--focus-ring` con `color-mix` del primario. Tres `color: #fff` de Compras pasaron a
  `--color-on-primary`.
- Las pantallas de Auth fuerzan `data-theme="light"`: el logo oficial siempre sobre fondo claro.

### A.5 Guardado, carga y multi-dispositivo

- `AparienciaProvider` (debajo de Auth): lee `profiles.appearance` al iniciar sesión (React Query),
  aplica, y guarda cada cambio con la RPC `guardar_mi_apariencia`. **Vista previa optimista**: el cambio se ve al instante; si el
  servidor rechaza, vuelve a lo último confirmado y el diálogo muestra la alerta.
- Caché `bt-apariencia` en `localStorage` **con el id del usuario**: `main.tsx` la aplica antes del
  primer render si hay sesión guardada (sin destello). Se borra al cerrar sesión. La de otro
  usuario se ignora.
- Sin sesión: siempre el original.

### A.6 Panel «Apariencia»

- Botón con ícono en el header (entre empresa y usuario), `aria-haspopup="dialog"`. El diálogo se
  descarga recién al abrirlo (o al pasar el puntero/foco por el botón): 5,6 kB JS + 3,7 kB CSS aparte.
- `Dialog` accesible: foco inicial en el tema elegido, Tab atrapado, Escape cierra y devuelve el foco.
- Cuatro `fieldset` con `legend` (grupos nombrados) de radios nativos: flechas para moverse,
  nombre completo en cada opción («Grafito, tema oscuro»), la elegida marcada por el radio, borde
  doble y tilde (no sólo color), foco visible en la tarjeta.
- Muestra de cada tema con sus propios tokens (header, superficie, línea y botón).
- Pie: «Guardando…» anunciado, «Restaurar original» (deshabilitado si ya es el original), «Listo».

## B. Identidad visual por módulo

| Módulo | Claro | Oscuro |
|---|---|---|
| Ventas | verde `#15803d` (texto blanco 5,0:1) | verde `#4ade80` con texto oscuro |
| Compras | azul `#1d4ed8` (6,7:1) | azul `#60a5fa` con texto oscuro |
| Mantenimiento | grafito `#374151` (10,3:1) | grafito claro `#94a3b8` con texto oscuro (nada de botón negro sobre negro) |
| Catálogo, Clientes, Emails, Informes, Configuración, Inicio | acento global (del tema o elegido) | idem |

- El shell pone `data-modulo` en el `<html>` según la ruta (así los diálogos en portal lo heredan) y
  lo quita al salir.
- Tokens conceptuales: `--module-accent`, `--module-accent-hover`, `--module-accent-soft`,
  `--module-accent-border`, `--module-accent-text` (fuera de los tres módulos = acento global).
- Dentro del módulo el verde/azul/grafito pisa el acento del usuario (y el del tema) en: indicador y
  navegación activa, acciones primarias, selección, foco y enlaces.
- **No cambia**: marca (logo, header), badges de estado, alertas de error, advertencias y el aviso STEL
  (test: los bloques de módulo y acento no declaran ningún token de estado; verificado en navegador:
  el aviso STEL en Ventas oscuro sigue `--color-warning-soft/-text`, «Nueva cotización» sigue
  deshabilitada).

## C. Readiness del cutover (resumen; detalle en la auditoría)

**`CUTOVER_READY = NO`**

**Razón principal:** el proyecto legacy está restringido por cuota de egress; `stel-daily-sync`
devuelve **HTTP 402**; el store legacy no recibe documentos desde el **2026-09-12**. Por lo tanto
**no se puede conocer desde esta fuente el último número realmente emitido por STEL hoy**, y sin ese
número no hay secuencia segura ni reconciliación completa.

| Tipo | Clasificación (con la razón principal resuelta) |
|---|---|
| quotes | READY_WITH_FIXES |
| sales_orders | READY_WITH_FIXES |
| deliveries | **NOT_READY** |

### C.1 Bloqueantes

1. **Último número real de STEL desconocido** (razón principal, arriba).
2. **Convivencia con STEL sin resolver:** nada impide que STEL siga emitiendo los mismos números.
3. **COTI02541–02547 faltantes** en React.
4. **RT0000001424–1426 faltantes** en React (y la secuencia de remitos en 1424: colisión).
5. **10 SKU de los documentos faltantes inexistentes en React** (PRO12600, PRO12602, PRO12603,
   PRO12604, PRO12605, PRO12606, PRO12608, PRO12609, PRO12610, B2036LA-2).
6. **32 + 9 documentos sin moneda** (32 importados, 9 del delta).
7. **Cambios de moneda entre documentos relacionados:** PDV01223 (USD) ← COTI02339 (ARS);
   RT0000001382 (ARS) ← PDV01274 (USD).
8. **Default silencioso a USD** al convertir una cotización sin moneda en pedido.
9. **Cancelación de remito despachado sin corrección de stock** (severidad alta, ver C.6).
10. **U-B-2 productos/precios:** maestro de productos y de precios sin decidir; lista por defecto
    sólo USD; línea sin precio entra en 0 sin bloqueo.

### C.2 Correcciones propuestas (NO ejecutadas)

| # | Corrección | Tipo | Bloquea |
|---|---|---|---|
| F1 | Restablecer el sync o leer STEL directo; lista de documentos y últimos números por tipo | Operación | todos |
| F2 | Importar el delta con la vía de importación (service role + `imported_at`, sin consumir secuencias) y reconciliar con `scripts/fase14-*` | Datos | todos |
| F3 | Alta de los SKU faltantes y decisión U-B-2 (maestro de productos y de precios, lista ARS o regla de conversión explícita) | Negocio + datos | quotes, orders |
| F4 | Conversión cotización → pedido: no asumir USD; exigir moneda | Código | orders |
| F5 | Pedir el número recién cuando el alta es válida o anular el hueco con auditoría | Código | orders (menor) |
| F6 | Cancelar un remito despachado: bloquear o generar movimiento compensatorio y recalcular cumplimiento | Código + base | deliveries |
| F7 | Decidir si el vendedor crea cotizaciones en el ERP (hoy no) | Negocio | quotes |

### C.3 Próximas secuencias seguras

| Tipo | Hoy (`next_number`) | Mínimo seguro con lo conocido | Regla en el corte |
|---|---|---|---|
| quote | 2629 | 2548 (legacy máx. 2547) | `max(2629, último COTI de STEL + 1)`; mantener 2629 si STEL no pasó 2628 (hueco visible de 81 números, aceptable) |
| sales_order | 1316 | 1316 (legacy máx. 1315) | último PDV de STEL + 1 (hoy al límite) |
| delivery | **1424 (colisiona)** | **1427** | último RT de STEL + 1 (≥ 1427) |

### C.4 Plan exacto (NO ejecutar; por tipo, primero quote, después sales_order, remitos al final)

1. **Detener/fijar la emisión en STEL** del tipo: aviso al equipo con fecha y hora; en STEL, dejar de
   crear documentos de ese tipo (permiso o acuerdo operativo firmado). Registrar la hora de congelado.
2. **Obtener los últimos números** en STEL (pantalla de STEL, no el legacy) y la lista completa de
   documentos posteriores al 2026-09-09.
3. **Importar el delta** con la vía de importación y **reconciliar** con el método de la auditoría:
   0 `IN_SOURCE_NOT_REACT`, 0 diferencias de cabecera/líneas/cliente.
4. **Alinear la secuencia React** con service role, en una transacción:
   `update document_sequences set next_number = <STEL + 1> where company_id = <buscatools> and doc_type = '<tipo>' and is_default and next_number < <STEL + 1>`.
5. **Verificar unicidad**: 0 duplicados por empresa + tipo + número normalizado; `next_number` >
   máximo existente (incluidos atípicos por debajo del próximo); `config_numeracion_diagnostico` en
   `OK`/`AHEAD`.
6. **Cambiar la autoridad** del tipo: `update document_numbering_authority set authority = 'ERP', reason = '<motivo con fecha>' where company_id = <buscatools> and doc_type = '<tipo>'` (queda en la bitácora de autoridad).
7. **Smoke test controlado** con un admin real: crear un borrador, guardarlo (consume un número),
   verificar número, totales y cliente; **no enviarlo**. Si es de prueba: dejarlo documentado como
   anulado (rechazar/cancelar), no borrar.
8. **Habilitar la UI**: sin cambios de código (los botones se habilitan solos al leer la autoridad);
   `AvisoAutoridadStel` desaparece sólo para ese tipo. Recién después del corte real se decide
   retirar el componente.
9. **Monitorear** 48–72 h: numeración del día contra STEL (que no emita), totales, monedas nulas (0),
   remitos despachados y saldos, auditoría de ventas.

### C.5 Rollback

| Aspecto | Qué hacer |
|---|---|
| Volver ERP → STEL | `update document_numbering_authority set authority = 'STEL', reason = 'rollback <fecha>'` para el tipo; la UI vuelve a bloquear emisión en ≤ 5 min (caché) y el servidor bloquea al instante |
| Números ya consumidos por el ERP | **No se reutilizan.** Antes de reactivar STEL, fijar en STEL su próximo número por encima del último del ERP (p. ej. si el ERP llegó a COTI02635, STEL sigue en 2636) |
| Documentos emitidos en el ERP durante la ventana | Se conservan con su número y auditoría; si deben seguir vivos en STEL, se cargan allá con el mismo número (y no al revés) |
| Documentos de prueba | No se borran: se rechazan/cancelan con motivo «smoke test cutover <fecha>» para que el número no quede como hueco sin explicación |
| Evitar duplicados | Nunca bajar `next_number` en React; nunca dejar STEL y ERP emitiendo el mismo tipo a la vez; repetir la verificación de unicidad antes y después |

### C.6 Hallazgo de severidad ALTA: cancelar un remito despachado no restaura stock

**Qué pasa hoy** (reproducido en el fixture `zz-f14`, sin tocar datos reales):

1. Remito en borrador → `confirmar_entrega` → movimientos `sale_delivery` negativos, saldo baja,
   estado `shipped`, cumplimiento del pedido recalculado.
2. El mismo remito se puede pasar a `cancelled` con un UPDATE directo (la misma vía que usa la UI
   para cancelar).
3. **No se genera movimiento compensatorio, el saldo queda descontado y el pedido sigue
   `delivered`/`partially_delivered`.** Stock y cumplimiento quedan inconsistentes con el documento.

**Severidad:** alta. Hoy no afecta datos reales (Buscatools no emite remitos desde el ERP: autoridad
STEL), pero **bloquea el cutover de `delivery`**.

**Antes de cualquier cutover de `delivery` debe corregirse** (no se corrige en esta entrega; requiere
autorización) y quedar cubierto por tests:

| Test requerido | Esperado |
|---|---|
| Despacho | stock baja exactamente lo despachado; un movimiento por línea con producto |
| Cancelación de un remito despachado | comportamiento **definido y consistente**: o bien se bloquea, o bien genera el movimiento compensatorio y recalcula el cumplimiento, en una sola operación del servidor |
| Reintento idempotente | repetir la cancelación (o el despacho) no cambia nada la segunda vez |
| Sin doble movimiento | ni el despacho ni la cancelación pueden producir dos movimientos para la misma línea, tampoco en concurrencia |

## D. Tests

### D.1 Frontend (Vitest)

| Suite | Casos |
|---|---|
| `src/styles/tokens.test.ts` | +7: catálogo y bloques; lista blanca SQL = ids TS; original = capa 1; **AA en 544 combinaciones**; módulos verde/azul/grafito en claro y oscuro pisando el acento; módulos/acentos no tocan estados; header con foco propio y placa del logo |
| `src/features/apariencia/opciones.test.ts` | 6: catálogo, normalización de basura, atributos del `<html>`, caché por usuario, aplicación antes del render sólo con sesión, módulo por ruta |
| `src/features/apariencia/AparienciaProvider.test.tsx` | 8: default, carga del servidor y otro dispositivo, optimista + guardado, error → revierte, restaurar = NULL, valor inválido, aislamiento A/B, sin sesión |
| `src/features/apariencia/DialogoApariencia.test.tsx` | 7: grupos y radios, estado elegido y nombres accesibles, elegir, muestras con su tema, restaurar, guardando/error, cerrar |
| `src/layouts/AppLayout.test.tsx` | +2: botón «Apariencia» abre el diálogo y elige; `data-modulo` por ruta y limpieza |

### D.2 Base (JWT reales, fixtures)

| Script | Resultado |
|---|---|
| `scripts/fase14-apariencia-tests.mjs` | TODO PASA. RPC: guardar la propia y leerla desde otra sesión; 17 presets aceptados; 10 inválidos rechazados por el CHECK. **Red team:** A por REST sobre su perfil (appearance directo, is_active, full_name, phone, avatar_path, locale, theme, deleted_at, created_at, updated_at, id, INSERT, DELETE, UPSERT) → BLOCKED y fila intacta; A sobre B (REST, UPSERT, RPC con `p_user`/`id` inyectados) → BLOCKED y B intacto; anon (RPC, UPDATE, INSERT, SELECT) → BLOCKED; rol y membresía intactos. Restaurar NULL. **Flujos legítimos:** alta de usuario por trigger, login y lectura del perfil propio y de compañeros, membresías, service role, `config_listar_usuarios`. Perfiles y membresías reales idénticos |
| `scripts/fase12-configuracion-entrega1-tests.mjs` (revalidación Configuración E1) | 86 PASS, 0 FAIL (casos con envío real omitidos por defecto). Se actualizó una expectativa: «el perfil propio sigue editable» pasó a «ya no se edita por REST» |
| `scripts/fase14-ventas-cutover-fixture-tests.mjs` | TODO PASA (ver auditoría §10–11) |

### D.3 Navegador (localhost + fixture `zz-f13ui`)

- Teclado: foco inicial en el tema elegido; ArrowRight elige «Oscuro naranja», se aplica y se guarda
  (`profiles.appearance` verificado); Escape cierra y el foco vuelve a «Apariencia».
- Persistencia: recarga → la apariencia está aplicada antes de montar (caché) y coincide con el servidor.
- 9 rutas (Inicio, cotizaciones, pedido, pedidos de compra, orden de servicio, catálogo, cliente,
  informes, numeración) en **Oscuro naranja 1440**, **Azul corporativo claro + Grande + Clásica +
  acento violeta 1440 y 390**, **Gris pizarra oscuro + Compacto 768**, y 4 rutas a **430**:
  h1 = 1, desborde horizontal 0, tablas que desbordan 0, **AA 0**, blancos < 44px 0, inputs < 16px 0,
  controles sin nombre 0.
- Diálogo a 390/430/768/1440: sin desborde, 2/2/4/4 columnas de temas, todas las opciones ≥ 44px.
- Módulos: primario `#4ade80`/`#60a5fa`/`#94a3b8` en oscuro y `#15803d`/`#1d4ed8` en claro con acento
  violeta elegido; resto de módulos con el acento global.
- Restaurar original → `profiles.appearance` NULL y `<html>` en Claro naranja.
- Tras pasar el diálogo a carga diferida: se descarga al abrir, foco inicial en el tema elegido,
  Escape devuelve el foco a «Apariencia», consola sin errores.

### D.4 Gates

| Gate | Resultado |
|---|---|
| lint | 0 |
| typecheck | 0 |
| `npm test` | 97 archivos · **951** tests OK (dos corridas seguidas) |
| `npm run test:isolated` | **951** OK |
| build | OK; sin fixtures ni medidores en `dist` |

`testTimeout` pasó de 5 s (default) a 15 s en `vite.config.ts` y `vitest.aislado.config.ts`: con 97
archivos en paralelo, el primer test de dos archivos jsdom pesados (Inicio y shell) llegó a 5 s por
contención de CPU; solos tardan ~0,3 s. No es un test que falle: es margen de arranque.

### D.5 Bundle (build de producción; E6 = `5e7e5ea`)

| | E6 | E0 Fase 14 |
|---|---|---|
| Entrada JS | 125,0 kB (gz 36,5) | 130,5 kB (gz 38,1) |
| Entrada CSS | 22,2 kB (gz 5,0) | 37,3 kB (gz 7,5) — los 17 presets, 8 acentos y 3 módulos en tokens |
| Diálogo de apariencia | — | 5,6 kB JS (gz 1,9) + 3,7 kB CSS, bajo demanda |

### D.6 Base antes / después (empresas no `zz`, md5 por fila completa)

Idénticos: usuarios de Auth, perfiles reales (todas las columnas previas; `appearance` NULL en los
7), empresas, membresías, clientes, contactos, alias, cotizaciones y líneas, pedidos y líneas,
remitos y líneas, secuencias (quote 2629, sales_order 1316, delivery 1424), **autoridad STEL ×3**,
bitácora de autoridad, productos, precios, listas, stock (saldos, movimientos, reservas),
proveedores, compras, mantenimiento, cuentas y eventos de email, auditorías, depósitos.
Sólo crecieron las tablas vivas del sync de Gmail: hilos 325 → 337, log 248 → 284.
Residuos: 0 empresas y 0 usuarios `zz`, 0 huérfanos. Cambio de esquema: la columna
`profiles.appearance`, la función `app.apariencia_valida` y su CHECK (migración de esta entrega).

## E. Criterio de cierre de la entrega

| Criterio | Estado |
|---|---|
| Apariencia por usuario | PASS |
| Escritura de `profiles` acotada a `appearance` por RPC | PASS (red team) |
| Presets AA | PASS (544 combinaciones) |
| Acentos de módulo | PASS |
| Sistema de diseño intacto (CSS de módulos sin tocar salvo 3 `#fff` → token) | PASS |
| Auditoría de Ventas completa | PASS |
| Diferencias conocidas y documentadas | PASS |
| Fixture E2E | PASS |
| Readiness clasificada | **CUTOVER_READY = NO** (legacy restringido, sync 402, sin datos desde 2026-09-12) · quotes/orders READY_WITH_FIXES · deliveries NOT_READY |
| Plan de cutover y rollback | Definidos |
| Cutover NO ejecutado | PASS (autoridad STEL ×3 intacta) |
| Limpieza | PASS (0 `zz`, navegador sin sesión ni storage, servidor local detenido, temporales borrados) |
