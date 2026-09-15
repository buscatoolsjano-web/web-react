# FASE 13 — REDISEÑO GLOBAL · ENTREGA 5 — MANTENIMIENTO + EMAILS + INFORMES + CONFIGURACIÓN

> Migración visual controlada de los cuatro módulos restantes sobre las primitivas de E1–E4.
> **Sin cambios de lógica**: mismas consultas, RPC, RLS, permisos, estados, flujos, numeración,
> auditoría y cálculos. **0 archivos de `services/`, `hooks/`, `lib/` o `types/` modificados** en los
> cuatro módulos. Emails: backend (Gmail, Cloud Run, SMTP, Secret Manager) sin tocar, sin redeploy,
> sin envíos ni borradores reales. Módulos fuera de alcance (Ventas, Compras, Catálogo, Clientes,
> Dashboard, Login, WhatsApp): 0 archivos. Base: `45a5b55` (E4 cerrada). Fecha: 2026-09-14.

## A. Baseline

### Rutas medidas (22)

| Módulo | Rutas |
|---|---|
| Mantenimiento | `/mantenimiento/ordenes`, `/ordenes/:id` (orden con torque, cotización USD, repuestos, checks), `/ordenes/nueva`, `/activos`, `/activos/:id`, `/puntos` |
| Emails | `/emails`, `/emails?estado=pendiente`, `/emails/:id`, `/emails/redactar`, `/emails/borradores` |
| Informes | `/informes`, `/informes?vista=stock` |
| Configuración | `/empresa`, `/numeracion`, `/usuarios`, `/listas-precios`, `/listas-precios/:id`, `/marcas`, `/categorias`, `/atributos`, `/auditoria` |

### Fixture (`scripts/fase13-rediseno-ui-fixture.mjs`, empresas `zz-f13ui-*`)

Ampliado para E5: 3 puntos de revisión; orden preventiva con torque requerido, condición visual,
cotización en USD (2 líneas), 3 mediciones, 2 checks, un depósito `ZZ-DEP` y un repuesto sin consumir;
una cuenta de correo **falsa** en dominio `.test` (no llega a Gmail), 5 hilos con estado de trabajo
(pendiente / en proceso / resuelto), asignación, cliente y lecturas; eventos de auditoría de usuarios y
de catálogo. `limpiar` borra además `email_thread_reads` y `email_sync_log` por cuenta.

**Emails sin Gmail real**: el contenido de los hilos se miró con un interceptor de `fetch` en el
navegador (archivo temporal ignorado, ya borrado) que devolvía un hilo falso (3 mensajes, 1 imagen
remota, 2 adjuntos) y bloqueaba todo lo demás con 503. Registro del interceptor en toda la sesión:
sólo `GET /gmail/thread` y `GET /gmail/drafts`. **Nunca se escribió en el composer** (el autoguardado
crea borradores en Gmail): ni borrador, ni envío, ni descarte reales.

### Medición ANTES (localhost, 22 rutas × 1440/1024/768/390)

| Hallazgo | Dónde |
|---|---|
| Glifos unicode como íconos: `✓ ○ —` en etapas y cierre, `↑ ↓` en orden de columnas y cotización, `← →` en paginador y «volver», `×` para quitar, `📎`, `★` | Mantenimiento (órdenes 3, detalle 6, activos 3), Emails (bandeja 5, hilo 3), Informes 1, Listas 1 |
| Tablas que desbordan su caja | 1024: órdenes 169 px, equipos 148 · 768: órdenes 249, equipos 228, numeración 215, usuarios 99, atributos 10, auditoría 193 · 390: puntos 123 |
| Blancos táctiles < 44 px a 390 | cliente vinculado del hilo 21 px, enlaces de listas de precios 24 px |
| `/emails/redactar` sin h1 | — |
| Plural roto: «1 miembros» (Usuarios), «1–1 de 1 eventos» (Auditoría) | Configuración |
| Pestañas de Informes encima del h1 (no ARIA) | Informes |
| `window.confirm` al descartar borrador | Composer |
| Pestañas de la orden y del equipo con `aria-current` (no patrón de pestañas) | Mantenimiento |
| h1 = 1, scroll horizontal 0, AA 0 | resto de las rutas |

### Base de datos ANTES (empresas no `zz-`)

Conteo + md5 por fila de 34 tablas/grupos (Mantenimiento, Emails, empresa, membresías, catálogo,
listas y precios, numeración y autoridad, auditorías, clientes, ventas, stock, depósitos).
Ver la comparación en §H.

## B. Mantenimiento

| Pieza | Antes | Ahora |
|---|---|---|
| `OrdenesPage`, `ActivosPage` | header propio, `<p class=error>`, «+ Nueva» | `PageHeader` (subtítulo «1 orden / N órdenes»), acciones ghost (Equipos, Puntos), CSV secondary con ícono, **una** primaria (Nueva orden/equipo, sólo si `permisos.crear`); `Alert` sin acceso; `ErrorState` con Reintentar; `EmptyState` distinto para «sin resultados» (con Limpiar) y «todavía no hay» |
| `FiltrosOrdenes`, `FiltrosActivos` | barra propia con plegado propio | `FilterBar` + `Field`/`Input`/`Select`; mismo estado, mismos valores, mismo debounce de 300 ms, mismo conteo de filtros |
| `ListadoOrdenes`, `ListadoActivos` | tabla propia, flechas `↑↓` | `Tabla.module.css` común, ícono `arrow-up/down` + `aria-sort`, `SkeletonRows`; columnas secundarias ocultas bajo 1280 (servicio, técnico, alta, tipo) y bajo 1024 (ingreso, modelo) — el dato sigue en la ficha y en la tarjeta mobile |
| `Paginador` | `← Anterior / Siguiente →`, «1–25 de 30» | adaptador sobre `Pagination` (mismo contrato 1-based, tamaños 10/25/50/100) con sustantivo |
| `ChipEstado` | clases propias | `Badge`: estado de orden (brand/success/danger outline), etapa neutral, espera warning+dot, presupuesto con la palabra «Presupuesto», situación, resultado, veredicto, baja. Mismas etiquetas |
| `OrdenDetallePage` | «← Órdenes», h1 + chips, pestañas `aria-current`, cancelación en bloque inline | `PageHeader` con back, **equipo · serie · cliente · técnico** en el subtítulo y los cuatro chips en `status`; `ActionBar` con «Cancelar orden» en el grupo de peligro (sólo si abierta y editable); `Tabs` + `TabPanel` (← → Inicio Fin) con conteos; Torque sin conteo cuando no es requerido («Torque (no requerido)»); secciones con `DocSection`/`MetaList`/`Missing` |
| Cancelación | textarea + «Confirmar cancelación» inline | `ConfirmDialog` danger con el motivo (`Field` + `Textarea`) como contenido y el error adentro; **misma** `acciones.cancelar.mutate(motivo, { onSuccess })` |
| `ActivoDetallePage` | 3 botones sueltos | `ActionBar`: primaria Nueva orden, secundarias Editar/Reactivar, peligro Dar de baja (misma mutación directa, sin confirmación nueva); aviso de baja como `Alert`; pestaña Órdenes con `EmptyState` propio |
| Altas (`OrdenNuevaPage`, `ActivoNuevoPage`) | «← Órdenes» + h1 | `PageHeader` con back; Skeleton al precargar el equipo |
| `PuntosPage` | tabla y botones propios | tabla común, `Badge` Activo/Inactivo, `Button` sm, `Field`/`Input` al editar y al agregar; mismas mutaciones |
| `PanelEtapas` / `PanelCierre` | `✓ ○ —` | `Icon` check-circle / circle / arrow-right (en curso) / minus, siempre al lado de su palabra |
| `PanelCotizacion` | `↑ ↓` | `IconButton` arrow-up/down con los mismos `aria-label` («Subir …», «Bajar …») |
| `PanelAdjuntos`, `SelectorProducto` | `×` | `IconButton` trash (danger) / x; el borrado de adjunto sigue siendo directo |
| `PanelHistorial` | «A → B» en texto | ícono arrow-right con nombre accesible «a»; Skeleton y EmptyState compact |
| Botones de paneles y formularios | 42 `<button class=primario/secundario/peligro/mini>` | `Button` (primary / secondary / danger / secondary sm); mismos `onClick`, `disabled`, `type` y contenido |
| CSS | `Filtros`, `Paginador`, `ChipEstado` `.module.css`; clases de botón duplicadas; `#fff`, `opacity` en deshabilitados | los tres archivos borrados; `Listado` y `Pagina` reescritos (sólo lo propio); clases de botón podadas; focos con `--focus-outline`; sin opacidad en `.opcion:disabled` (la elegida se sigue leyendo con su color en sólo lectura) |

## C. Emails

| Pieza | Ahora |
|---|---|
| Bandeja (`EmailsPage`) | `PageHeader` «N hilos · M sin leer · cuenta», acciones Actualizar (ghost, ícono refresh), Borradores, Nuevo email (primaria); `Alert` para canal caído y errores de sincronización; `FilterBar` (mismo debounce); `ErrorState`; `EmptyState` para sin cuenta / sin resultados / vacía / página fuera de rango; `SkeletonRows`; `Pagination` «1 hilo / N hilos». Densidad de lista de dos líneas conservada |
| `ListadoEmails` | `📎` → ícono paperclip + texto sr-only «Tiene adjuntos»; «Sin leer» con texto; `BadgeEstado` (pendiente neutral, en proceso info, resuelto success) |
| Hilo (`EmailHiloPage`) | `PageHeader` con back a la bandeja (conserva filtros), asunto como h1, estado en `status`; carga del contenido: Spinner + «Trayendo el hilo desde Gmail…» + skeleton (**sin polling nuevo**); aviso de borradores como `Alert` con botones; mensajes con chevron, conteo de adjuntos y `Button` Responder / Responder a todos / Reenviar |
| `PanelTrabajo`, `PanelCliente` | `Field`/`Select`, `Button`, `Spinner`; `★` → `Badge` «Recomendada»; el cliente vinculado mide 44 px en mobile |
| `CuerpoSeguro` | **no se tocó** (sanitización, iframe sandbox, CSP, bloqueo de imágenes remotas, descarga del contenido). Sólo estilos del contenedor. Verificado: la imagen remota del hilo falso sigue bloqueada |
| Composer | `Field`/`Input`/`Textarea`, `IconButton` para quitar destinatario, `Alert` para inciertos y errores, indicador de autoguardado con Spinner / check / alerta **y texto**, pie con Enviar (primaria), Guardar borrador, Cerrar y Descartar al final. `window.confirm` → `ConfirmDialog` danger «¿Descartar este borrador?» / «Se borra de Gmail y no se puede recuperar.»; sin contenido se descarta directo, igual que antes. `useComposer` (client_request_id, idempotencia, conciliación, borradores) **sin cambios** |
| Redactar / Borradores | `PageHeader` (Redactar ya tiene h1), Skeleton, `ErrorState`, `EmptyState`, `Badge` de modo |
| Sin acceso | `SinAccesoEmails`: `PageHeader` + `EmptyState` |

## D. Informes

| Pieza | Ahora |
|---|---|
| Navegación | `Tabs` compartido (tablist, ← → Inicio Fin) + `TabPanel`; la URL es la misma (`?vista=stock`, conserva `?mes=`) y sigue agregando entrada al historial |
| Jerarquía | un solo h1 «Informes» (`PageHeader`); cada vista titula con h2 («Actividad comercial», «Stock») |
| Estados | Skeleton en lugar de «Leyendo…»; `ErrorState` con Reintentar sólo cuando reintentar sirve (misma condición `codigo === 'desconocido'`); aviso de documentos a revisar como `Alert` warning |
| Controles | Actualizar y CSV como `Button` (ícono refresh / download, loading); mes con `Field` + `Input type=month`; exportar con `Field` + `Select`; Buscar en stock y kardex como `Button`. Las funciones de exportación son las mismas |
| Paginado | adaptador sobre `Pagination` (0-based) con «saldo/saldos», «movimiento/movimientos» |
| KPI | tarjetas con el número dominante (`--text-xl`, tabular), título secundario; la alerta con borde izquierdo. Las cifras por moneda siguen en filas separadas: **no se suman monedas** |
| Tablas | densas, scroll dentro de su tarjeta; chips deshabilitados sin opacidad; focos con tokens |
| «1 eventos» | en Informes todas las cantidades ya usaban `plural()`; el caso roto estaba en Auditoría (§E) |
| CSS | bloque base reescrito con tokens, `.pestanas*`, `.boton`, `.error`, `.aviso`, `.inputMes`, `.paginador` eliminados |

## E. Configuración

| Pantalla | Ahora |
|---|---|
| Shell | sin acceso → `PageHeader` + `EmptyState`; carga → Skeleton; navegación interna con foco visible y 44 px |
| Todas (9) | `PageHeader` con subtítulo y, donde corresponde, `Badge` «Sólo lectura» en `status` |
| Empresa | secciones (fieldset) sin cambios de campos; `status` muestra **«Cambios sin guardar»** con el mismo `hayCambios` que ya habilitaba Guardar; logo sin imagen con ícono; Skeleton / `ErrorState` |
| Numeración | autoridad, emisión bloqueada y estado como `Badge` con punto (warning/danger), el detalle sigue en `title` y escrito en la card mobile; las alertas de conflicto como `Alert` warning; aviso «Sólo lectura» y nota de STEL **sin suavizar** (mismos textos, mismo `StatusMessage`) |
| Usuarios | «1 miembro / N miembros»; estado como `Badge` (activo success, invitación pendiente / sin confirmar warning, suspendido / bloqueada danger); «vos» como `Badge`; Invitar como primaria con ícono; confirmación de suspender / degradarse con botón danger; `FormularioInvitacion` con `Field` (email, nombre opcional, rol) — **no se envió ninguna invitación ni se cambió ningún rol** |
| Listas (sólo lectura) | `Badge` moneda y «Predeterminada»; detalle con back, `Field` para búsqueda y vigencia, `Pagination` «precio/precios», vigencia como `Badge`, 44 px en el enlace a 390 |
| Marcas / Categorías | mismo layout: `PageHeader` + acción primaria (admin), búsqueda `Field`, filtro de estado `Field`/`Select`, `Badge` Activa/Inactiva/En revisión, eliminar con botón danger; conteos con singular |
| Atributos | sólo lectura, búsqueda `Field`, «1 atributo / N atributos» |
| Auditoría | `FilterBar` (búsqueda visible, fechas/módulo/evento/actor plegables en mobile, Limpiar filtros), error de rango con `role=alert` e ícono, `ErrorState` con Reintentar (salvo sin permiso), `Pagination` **«1–1 de 1 evento» / «1–50 de 120 eventos»**, «Ver detalle» como `Button` ghost con chevron y `aria-expanded`/`aria-controls` |
| `Dialogo` | mismo contrato (`titulo`, `pie`, `onCerrar`, `bloqueado`) sobre el `Dialog` común: foco atrapado, Escape, fondo inerte, hoja inferior en mobile |
| CSS | `.encabezado`, `.titulo`, `.chip*`, `.tono_*`, `.fondo`, `.caja`, `.pie`, `.peligro`, `.alerta`, `.paginador`, `.filtrosAuditoria` eliminados; resto con tokens, sin `opacity` en deshabilitados |

## F. Responsive (DESPUÉS, 22 rutas × 4 anchos)

Todas las rutas: **h1 = 1** (incluida `/emails/redactar`), **scroll horizontal de página 0**, 0 glifos
unicode detectados, 0 alertas inesperadas, 0 inputs < 16 px en táctil.

| Ancho | Tablas que desbordan su caja | Blancos < 44 px |
|---|---|---|
| 1440 | 0 | 0 |
| 1024 | numeración 150, usuarios 19, auditoría 113 (Mantenimiento 0; antes órdenes 169, equipos 148) | 0 |
| 768 | numeración 215, usuarios 99, atributos 10, auditoría 193 — **idénticos al píxel al baseline** (Mantenimiento 0; antes órdenes 249, equipos 228) | 0 |
| 390 | puntos 74 (antes 123) | 2 falsos positivos: el `input type=file` visualmente oculto de redactar y de empresa (el control visible es la etiqueta de 44 px, igual que antes). Cliente del hilo 21 → 44 px; enlaces de listas 24 → 44 px |

Nota sobre 1024 en Configuración: el baseline registró 0, pero a 768 los valores coinciden exactamente,
lo que muestra que las tablas no cambiaron; lo más probable es que a 1024 el baseline se midiera antes
de que llegaran los datos. El desborde es scroll **dentro** de la caja de `ResponsiveTable` (compartido
con Dashboard, fuera de alcance), nunca de la página. Queda como deuda (§L).

## G. Accesibilidad

- Contraste AA: 0 textos por debajo en las 88 mediciones. Deshabilitados sin opacidad (colores de
  `--color-text-disabled` sobre `--color-neutral-soft`).
- Foco: `--focus-outline`/`--focus-offset` en todos los controles propios que quedaron (chips de
  Informes, selector de rol, navegación de Configuración, botón de archivo del logo, enlaces).
- Estado nunca sólo por color: todos los `Badge` llevan texto; los íconos de etapa y cierre van al lado
  de su palabra; «Sin leer» y «Tiene adjuntos» son texto.
- Teclado (probado en el navegador):
  - pestañas de la orden: → selecciona Cotización, Fin → Historial, Inicio → Trabajo, ← desde el
    primero → Historial; tabindex itinerante (sólo la activa en 0); panel conectado;
  - pestañas de Informes: → cambia a Stock, conserva el foco y la URL (`?vista=stock`);
  - `ConfirmDialog` de cancelar orden: abre con el foco en «No cancelar», Escape cierra **sin mutar**;
  - Auditoría: «Ver detalle» enfocable, `aria-expanded` false → true, panel conectado.
- Composer: probado en jsdom (no se tipea en el navegador): diálogo `alertdialog`, foco inicial en
  «Volver», sin `window.confirm`, autoguardado anunciado con texto en `role=status`.

## H. Regresión visual y base de datos

- Capturas y mediciones en 1440/1024/768/390 con el fixture (ver §F). Sin superposiciones de
  `ActionBar`: va en el flujo de la página.
- **Base DESPUÉS**, empresas no `zz-`: las 34 filas **idénticas** al ANTES en conteo y md5 (incluidas
  `email_accounts`, `email_events`, `email_send_requests`, `email_thread_reads`; `email_threads` 272 y
  `email_sync_log` 174 sin cambios). `maintenance_*` 0, `document_sequences` y autoridad de numeración
  iguales.
- Limpieza: fixture borrado (3 empresas y 2 usuarios zz-f13ui); verificación SQL: 0 empresas `zz-`,
  0 usuarios `zz-`, 0 cuentas de correo `.test`, 0 huérfanos en hilos, lecturas, sync log, órdenes,
  membresías y auditorías, 0 depósitos `ZZ`. Sesión del navegador y `sessionStorage` borrados, `fetch`
  restaurado, servidor de preview detenido, viewport restablecido, archivos temporales `.zz-*` y builds
  de medición borrados.

## I. Bundle (gzip)

| | Antes | Después |
|---|---|---|
| Inicial estático (index + runtime + vendors + chunks importados) | 188.4 kB | 188.6 kB |
| Mantenimiento — código propio JS / CSS | 50.1 / 8.2 | 51.4 / 4.9 |
| Emails — propio | 35.1 / 3.3 | 36.6 / 3.2 |
| Informes — propio | 19.1 / 2.7 | 19.5 / 2.7 |
| Configuración — propio | 32.2 / 2.3 | 32.2 / 1.8 |
| Cierre completo del módulo (incluye chunks compartidos) JS | 52.1 / 37.2 / 21.2 / 35.8 | 61.3 / 44.5 / 24.7 / 40.6 |

El index pasa de 36.3 a 38.1 kB porque el chunk `Icon` (1.6 kB) se fusionó en él: el total inicial
sube 0.2 kB. El cierre de cada módulo crece por las primitivas que ahora usa (Pagination, FilterBar,
Tabs, Dialog, Field…), que son chunks compartidos y ya cacheados por Ventas/Compras/Catálogo/Clientes;
el código propio de cada módulo queda prácticamente igual y el CSS propio baja.

## J. Tests

Focales, sin snapshots:

- `mantenimiento/components/ListadoMantenimiento.test.tsx` (6): chips con texto y sin glifos, `aria-sort`
  e ícono en el listado, sublista sin botones de orden, tarjetas mobile, skeleton y vacío, paginador
  1-based con «1 orden / N órdenes».
- `emails/components/Composer.test.tsx` (4, hook mockeado): descartar con contenido → `ConfirmDialog`
  (foco en Volver, sin `window.confirm`), Volver no descarta, sin contenido descarta directo, estado del
  autoguardado con texto.
- `emails/components/ListadoEmails.test.tsx` (1): sin leer, estado, adjuntos y mensajes con texto; sin
  emoji; «(sin asunto)».
- `informes/components/NavegacionInformes.test.tsx` (3): tablist/tab/tabpanel, teclado conserva `?mes=`,
  paginador 0-based con plural.
- `configuracion/components/Dialogo.test.tsx` (2): modal con nombre y Escape; bloqueado no cierra.
- `configuracion/pages/AuditoriaPage.test.tsx`: nuevo caso «1–1 de 1 evento» / «1–50 de 120 eventos»;
  los 8 casos existentes (etiquetas de filtros, alerta de rango, Reintentar, cards) siguen iguales.
- `configuracion/pages/MaestrosPages.test.tsx`: el rango del detalle de lista pasa de «1–1 de 120» a
  «1–50 de 120 precios» (texto de `Pagination`).

Gates: `lint` ✓ · `typecheck` ✓ · `test` 90 archivos / 907 tests ✓ · `test:isolated` 90 / 907 ✓ ·
`build` ✓. Suites de base: sólo consultas de lectura (snapshot y residuos); no se corrió ninguna suite
que escriba en Buscatools.

## K. Bugs encontrados y corregidos

1. «1 miembros» en Usuarios → `contar()`.
2. «1–1 de 1 eventos» en Auditoría → `Pagination` con sustantivo.
3. Pestañas de Informes antes del h1 y sin patrón ARIA → `PageHeader` + `Tabs`.
4. `/emails/redactar` sin h1 → `PageHeader`.
5. Cliente vinculado del hilo (21 px) y enlaces de listas de precios (24 px) bajo el blanco táctil en 390.
6. Tablas de órdenes y equipos desbordando a 1024 y 768 → columnas secundarias ocultas por ancho.
7. `.opcion:disabled` con `opacity .6` en revisiones: en sólo lectura la opción elegida perdía color.
8. Pestaña Torque mostraba «Torque —» sin contexto → «Torque (no requerido)».
9. En la ficha del equipo, sin órdenes el mensaje decía «No hay órdenes que coincidan con estos filtros»
   (no hay filtros) → «Este equipo todavía no tiene órdenes de servicio».

## L. Deudas visibles

| Deuda | Estado |
|---|---|
| **Emails: cold start** del servicio de contenido | Sólo mejor feedback (Spinner + texto + skeleton + Reintentar). Sin polling nuevo ni cambios en Cloud Run: el arranque en frío sigue existiendo |
| **SPF / DKIM / DMARC** del dominio de envío | Sin cambios; pendiente de infraestructura |
| Auditoría singular/plural | **Resuelta** (§K.2) |
| Mantenimiento: íconos unicode | **Resuelta** en controles y estados. Quedan `×` como signo de multiplicar («2 × USD 10») y `→` en «Stock 5 → 3» y en un texto de reglas de Informes: son tipografía del dato, no íconos |
| Informes: pestañas | **Resuelta** (§D) |
| Tablas de Configuración a 768/1024 (numeración, usuarios, auditoría, atributos) | Scroll dentro de la caja de `ResponsiveTable`; requiere prioridad de columnas en el componente compartido con Dashboard (fuera de alcance) |
| Puntos de revisión a 390 | 74 px de scroll interno (antes 123); edición inline en tabla |
| Paneles de Mantenimiento (cotización, repuestos, torque, cierre) y formularios de alta/edición | Botones migrados a `Button`; campos, tablas y tarjetas internas siguen con sus clases (tokenizadas). Migrar a `Field` requiere revisar validaciones por campo: no era seguro sin tocar la lógica |
| `DialogoNombre` y `Campo` de Empresa | Siguen con su marcado propio: sus tests fijan `role=alert` en el error de campo, que `Field` no emite |
| `StatusMessage` en avisos de Configuración | Se conserva (primitiva del sistema); unificar con `Alert` sería una decisión transversal |
| Confirmaciones inexistentes | Borrar adjunto, dar de baja equipo y borrar punto de revisión siguen siendo directos, como antes: agregar confirmación sería cambiar el flujo |
| `components/Panel.module.css` de Mantenimiento | Sin uso desde antes de E5; no se borró por estar fuera del alcance visual |
| Configuración: pendientes de negocio | Sin cambios (numeración y autoridad para el cutover de STEL, precios no administrables desde el ERP) |
| Permisos heredados | Sin cambios: las acciones se ocultan con las mismas condiciones de antes (`permisosDe`, rol admin); la base sigue siendo la autoridad |
| `test:isolated` inestable (E3) | En esta entrega pasó en la primera corrida |
