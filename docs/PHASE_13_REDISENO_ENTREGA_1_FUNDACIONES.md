# FASE 13 — REDISEÑO GLOBAL · ENTREGA 1 — FUNDACIONES

> Tokens con alias de compatibilidad + primitivas propias + Dialog accesible (P0).
> **Sin migrar módulos**: ninguna pantalla de negocio cambió su JSX ni su lógica.
> Base: `main` en `e7f6ef0` (E0 pusheado, CI verde). Fecha: 2026-09-14.

## A. Decisiones de producto aplicadas (aprobadas por el usuario)

| Tema | Decisión | Dónde quedó |
|---|---|---|
| Sidebar | clara | `--color-sidebar-bg #fff` (shell se rediseña en E2) |
| Header | oscuro | `--color-topnav-bg #1a1a1a` |
| Densidad | comfortable | `--control-h-md 40px`, 44px en `pointer: coarse` |
| Marca | `#f37021` | `--color-brand-500` (identidad, foco de marca, indicador activo; **no** texto) |
| Botón primario | `#c2410c` | `--color-primary` (blanco encima 5.18:1) |
| Dashboard | métricas por rol | E6 |
| Nombre | Buscatools ERP | título de la pantalla de primitivas; shell en E2 |
| Fixture zz para capturas | aprobado | `scripts/fase13-rediseno-ui-fixture.mjs` |
| Toasts | E6 | no implementados |
| Dark mode | fuera de la fase | bloque legacy intacto, sin expandir |
| Sidebar compacta 64px (768–1023) / drawer < 768 | aprobados | tokens `--sidebar-w-compact`; implementación en E2 |
| Librería UI | no | 0 dependencias nuevas |
| SVG propios | aprobado | `src/components/icons/` (44 íconos) |

## B. Logo — búsqueda del asset oficial

Pedido: «buscar asset oficial; si hay SVG oficial, usarlo; no inventar/redibujar».

| Candidato | Qué es | Veredicto |
|---|---|---|
| `public/favicon.svg` (repo) | Cuadrado naranja con trazo blanco, creado en la **Fase 1** del proyecto (commit `81f8206`) | **No es oficial.** No se usa como logo |
| Backups locales del legacy | Sin imágenes de marca | — |
| PNG 1400×673 guardado del sitio (carpeta de descargas local, fuera del repo) | Logo «busca/tools» (naranja + gris, lupa) descargado del sitio buscatools.com | Parece el **logo oficial, pero en PNG** |
| SVG 3.6 kB (descargas locales) | Vectorización automática en **negro** del PNG (paths de trazado automático) | No es el SVG original |
| SVG 36 kB (descargas locales) | Vectorización automática **a color** (`#FF6E00` / `#303030`) del mismo PNG | No es el SVG original; su naranja no coincide con `#f37021` |
| PNG «LOGO BUSCATOOLS ADMIN» (descargas locales) | Isotipo «b» + lupa con la palabra ADMIN | PNG, variante |

**Resultado: no hay un SVG oficial confirmado.** No se incorporó ningún logo en E1 (el
header es de E2). Se necesita que el usuario confirme cuál es el archivo oficial o
provea el SVG de origen (ver §K).

## C. Tokens (`src/styles/tokens.css`)

Tres capas:

1. **Paleta y escalas nuevas**: `--color-*` (marca, primaria, superficies, bordes, texto,
   estados base/soft/text, shell, foco), `--space-0…10`, `--radius-sm/md/lg/full`,
   `--shadow-xs/sm/md/lg`, tipografía (`--text-label`, pesos, leading), controles
   (`--control-h-sm/md/lg`, `--touch-target`), movimiento (150/200 ms, reduced-motion → 0),
   shell (`--sidebar-w-compact`), breakpoints documentados y z-index completo.
2. **Alias de compatibilidad**: los 27 nombres de Fase 1 apuntan a la paleta nueva, y se
   definen las **4 variables que los módulos usaban sin existir** (`--accent`,
   `--warning-bg`, `--surface-soft`, `--on-primary`).
3. **Tema oscuro legacy**: sin cambios y sin expandir.

Ajustes respecto de la propuesta E0 (para compatibilidad visual razonable):

| Propuesta E0 | E1 | Motivo |
|---|---|---|
| Renombrar `--space-5/6` a 20/24px | Se mantienen 24/32px; se agregan `--space-8` (40) y `--space-10` (48) | Cambiarlos movía el espaciado de 95 CSS Modules |
| `--radius-lg 10px` | se mantiene 12px | idem (cards y login actuales) |
| `--border-strong` → `#8f8f8c` | alias a `--color-border-medium #d0d0cd`; las primitivas usan `--color-border-strong #8f8f8c` | En los módulos `--border-strong` también dibuja vacíos punteados y chips: con el gris fuerte quedaban pesados. Los controles de módulos pasan al borde fuerte al migrar cada módulo |
| `--success` = verde base | alias a `--color-success-text #166534` | 9 de 12 usos en módulos lo usan como **color de texto** |
| `--shadow-lg` más marcada | `0 8px 24px / .12` (casi igual a la anterior) | compatibilidad |

Contraste medido (script y test, fórmula WCAG 2.1):

| Par | Antes (E0) | Después |
|---|---|---|
| Blanco / primario | 2.94 ✘ | **5.18** |
| `--primary` como texto/link sobre blanco | 2.94 ✘ | **5.18** |
| `--text-muted` / blanco · / bg | 2.85 ✘ · 2.61 ✘ | **5.35 · 4.94** |
| `--text-soft` / blanco | 5.33 | 7.83 |
| `--success` / `--success-light` (chip ok) | 2.52 ✘ | **6.76** |
| `--warning-text` / `--warning-light` | 5.13 | 6.84 |
| `--danger` / blanco | 4.53 | 4.83 |
| Primitivas: textos de estado sobre soft | — | 6.76 – 8.01 |
| Borde de controles de primitivas | 1.26 ✘ | **3.24** (≥ 3 para 1.4.11) |
| `--border-strong` (alias, módulos) | 1.54 | 1.55 — **deuda**: se corrige al migrar cada módulo |

## D. Primitivas (`src/components/`)

| Componente | Archivo | Contrato |
|---|---|---|
| `Button` | `ui/Button.tsx` | variants `primary/secondary/ghost/danger`, sizes `sm 32 / md 40 / lg 48` (44 en `pointer: coarse`), `loading` (spinner + `aria-busy` + deshabilitado sin cambiar texto), `icon`, `block`, `forwardRef`. Deshabilitado **sin opacidad** (4.86:1). **API compatible** con los 40 usos existentes |
| `IconButton` | `ui/IconButton.tsx` | `aria-label` **obligatorio por tipo**; ghost/secondary/danger; sm/md; loading |
| `Badge` | `ui/Badge.tsx` | tonos neutral/info/brand/success/warning/danger, `dot`, `outline`; siempre con texto; el módulo mapea estado → tono |
| `Spinner` | `ui/Spinner.tsx` | decorativo, o `role="status"` con `label` |
| `Skeleton` / `SkeletonRows` | `ui/Skeleton.tsx` | bloques decorativos; filas de 44px con un único `role="status"` |
| `Field` | `forms/Field.tsx` | label + control + ayuda + error conectados por contexto (`id`, `aria-describedby` = error + ayuda, `aria-invalid`, `required`), «(opcional)», `hideLabel` |
| `Input` / `Textarea` / `Select` | `forms/controls.tsx` | 40px desktop, **44px y 16px en mobile/coarse**, estados hover/focus (anillo)/error/disabled/readonly; select nativo con flecha SVG |
| `Checkbox` / `Switch` | `forms/controls.tsx` | nativos (`role="switch"` en el switch), área táctil 44px, ayuda asociada |
| `Dialog` | `modals/Dialog.tsx` | **P0**: portal, `role dialog/alertdialog`, `aria-modal`, `aria-labelledby` + `aria-describedby`, foco inicial (ref, primer control o el diálogo), **Tab/Shift+Tab atrapados** (también si el foco cae al fondo), **Escape**, retorno del foco al disparador, `#root` **inert** + scroll bloqueado, pila para anidados, `busy` bloquea cierre, `closeOnOverlay`, hoja inferior < 768px |
| `ConfirmDialog` | `modals/ConfirmDialog.tsx` | reemplazo de `window.confirm`; `tone="danger"` → alertdialog, botón rojo, foco en **Cancelar**, no cierra con el fondo; `busy` → loading |
| `Pagination` | `tables/Pagination.tsx` + `rango.ts` | rango «1–50 de 1.234 pedidos» con **singular/plural** («1–1 de 1 evento»), es-AR, `aria-live`, Anterior/Siguiente, ocultos con una sola página |
| `EmptyState` / `ErrorState` | `feedback/` | título + descripción + CTA; error con `role="alert"` y Reintentar |
| `Icon` | `icons/Icon.tsx` + `iconPaths.ts` | 44 íconos SVG propios, 24×24, trazo 1.75, `currentColor`, `aria-hidden` |

**No se creó** (fuera de E1 o por regla de no sobre-abstraer): Toast (E6), Tabs, Card,
PageHeader/AppShell/Sidebar (E2), FilterBar y Table primitives (E3 al migrar listados),
`<DataTable>` genérico (nunca).

## E. Pantalla controlada `/dev/ui`

`src/app/dev/UiKitPage.tsx`: todas las primitivas en todos sus estados, sin datos ni
Supabase. La ruta se agrega sólo con `import.meta.env.DEV`: **verificado que no llega a
`dist/`** (0 coincidencias de la página en el build; 130 chunks JS, igual que antes).

Validación en navegador (localhost, Browser pane):

| Verificación | Resultado |
|---|---|
| Alturas: botones sm/md/lg | 32 / 40 / 48 px (fine pointer) |
| Colores computados | primario `rgb(194,65,12)` + blanco; deshabilitado `#f4f4f3` + `#6b6b68` |
| Inputs en grilla con ayuda en la fila | **Bug encontrado y corregido**: se estiraban a 51px → `align-content: start` → 40px todos |
| Switch en la misma línea que el siguiente | corregido (`display:flex`) |
| ConfirmDialog con teclado real | foco inicial en «Cancelar», Tab → Eliminar → Cancelar, Shift+Tab → Eliminar, Escape cierra, foco vuelve a «Eliminar documento», `#root` inert y `overflow:hidden` mientras está abierto y restaurados al cerrar |
| Dialog de formulario desktop | foco en «Nombre» con anillo; X, Cancelar, Guardar |
| Dialog en 390px | hoja inferior, «Guardar» arriba y a ancho completo, «Cancelar» debajo |

## F. Fixture y captura antes/después (módulos sin tocar)

`scripts/fase13-rediseno-ui-fixture.mjs preparar|limpiar`: una empresa `zz-f13ui` con 8
productos, 23 clientes, 7 cotizaciones (draft/sent/accepted/rejected/expired), 4 pedidos
(draft/confirmed/cancelled), 6 proveedores, 3 pedidos de compra, 4 equipos, 3 órdenes y un
admin zz. Magic link en archivo ignorado, sin imprimir; sin correos.

Antes de capturar se borró **sólo** la sesión fixture del navegador integrado
(`app.buscatools.com`: usuario zz de F12 ya eliminado; su token no había expirado por
fecha, pero el usuario no existía). Al terminar: sesión zz de localhost borrada, `limpiar`
→ **0 empresas, 0 usuarios, 0 productos, 0 clientes, 0 proveedores, 0 equipos, 0 líneas
huérfanas** (verificado por SQL).

Métrica objetiva: script en la página que recorre todos los textos visibles, calcula el
color efectivo (con opacidad) contra su fondo real y cuenta los que no llegan a AA.
Mismas 16 rutas, 1024px, mismos datos:

| Ruta | Fallan AA antes | Después |
|---|---|---|
| `/` | 4 / 57 | 1 |
| `/catalogo` | 15 / 105 | 4 |
| `/ventas/cotizaciones` | 14 / 91 | 3 |
| `/ventas/cotizaciones/:id` | 17 / 99 | 1 |
| `/ventas/pedidos` | 12 / 79 | 3 |
| `/ventas/pedidos/:id` | 24 / 140 | 1 |
| `/clientes` | 29 / 203 | 3 |
| `/clientes/:id` | 11 / 75 | 1 |
| `/compras/proveedores` | 12 / 90 | 3 |
| `/compras/pedidos` | 15 / 73 | 3 |
| `/mantenimiento/activos` | 10 / 69 | 3 |
| `/mantenimiento/ordenes` | 12 / 69 | 3 |
| `/informes` | 34 / 230 | 2 |
| `/configuracion/usuarios` | 5 / 45 | 1 |
| `/configuracion/auditoria` | 6 / 43 | 1 |
| `/no-existe` | 1 / 3 | 0 |
| **Total** | **221 / 1471** | **33** (−85 %) |

Los 33 restantes, inspeccionados uno por uno en Catálogo, Clientes e Informes:
- «WhatsApp (próximamente)» del sidebar con opacidad .45 → ítem inactivo (E2 lo rehace).
- Botones de paginadores de módulo **deshabilitados** con opacidad .45 y «Exportar ranking» deshabilitado (exentos por WCAG; se reemplazan por `Pagination`/`Button` al migrar).
- **Catálogo** (no exentos, van a E4): contador de facetas con opacidad .75 sobre primario (3.56:1) y el glifo `▣` de imagen faltante con opacidad .5 sin `aria-hidden` (en una segunda pasada, con la grilla completa, aparecieron 8 de estos glifos: la cifra de Catálogo depende de cuántas tarjetas estén renderizadas).

Capturas antes/después (1024 y 390) de cotizaciones, pedido detalle y la pantalla de
primitivas: **mismo layout, mismas posiciones y alturas**; cambian el naranja de acción
(más profundo), los links, los textos secundarios (más oscuros) y los fondos de chips
(más claros con texto más oscuro). Las capturas quedaron fuera del repo.

Observación (no se toca en E1): en el detalle de pedido la barra de acciones sticky se
superpone a la tabla de líneas tanto en 1024 como en 390 → E3.

## G. Sin cambios de lógica, base ni módulos

- `git diff` de E1 fuera de `src/components`, `src/styles`, `src/app/dev`, `scripts` y `docs`:
  sólo `src/app/routes.tsx` (+17 líneas: ruta DEV).
- 0 cambios en `src/modules/**`, `src/features/**`, `src/layouts/**`, services, hooks, RPC, SQL, RLS.
- Base: la única escritura fue el fixture zz aprobado, limpiado y verificado.
- 0 dependencias nuevas.

## H. Verificación

| Chequeo | Resultado |
|---|---|
| `npm run lint` | OK (0 warnings nuevos) |
| `npm run typecheck` | OK |
| `npm test` | **71 archivos / 806 tests OK** (+5 archivos, +41 tests) |
| `npm run test:isolated` | **71 / 806 OK** |
| `npm run build` | OK · `index` 106 → 108 kB · CSS total 210 → 215 kB · 130 chunks JS (sin cambios) |
| `node scripts/fase13-rediseno-auditoria.mjs` | variables no definidas **4 → 0**; tabla de contraste resuelve alias y mide la paleta nueva |

Tests nuevos: `Dialog.test.tsx` (14: rol/nombre/descripción, foco inicial, trampa de Tab,
foco fuera, Escape + retorno, busy, fondo, inert/scroll, anidados, initialFocusRef,
ConfirmDialog peligro y normal), `primitivas.test.tsx` (10: Button, IconButton, Badge, Spinner,
Skeleton, Empty/Error), `Field.test.tsx` (7), `Pagination.test.tsx` (6, incluye «1 evento»),
`tokens.test.ts` (variables no definidas en los 95+ CSS, 20 pares AA, 1.4.11, alias).

## I. Deudas y observaciones para las próximas entregas

1. `--border-strong` de módulos sigue en 1.55:1 → cada módulo pasa a `Field`/controles (E3–E5).
2. Los módulos siguen con sus botones, chips, paginadores y diálogos propios; los 2 `window.confirm` siguen (E3 Ventas, E5 Emails).
3. «1–1 de 1 eventos» en Auditoría se corrige al adoptar `Pagination` (E5).
4. «+ Nueva» visible a roles sin permiso (deuda F12) → E3.
5. Barra sticky superpuesta a líneas en detalle de pedido → E3.
6. Catálogo: contador de facetas 3.56:1 y glifo `▣` sin `aria-hidden` → E4.
7. Logo oficial sin confirmar (§B).
8. `bt-empresa-activa` del fixture quedó en el `localStorage` de localhost (sólo un id de empresa ya borrada; inofensivo).

## J. Archivos

Nuevos: `src/components/{ui/{IconButton,Badge,Spinner,Skeleton}.tsx+css, ui/primitivas.test.tsx,
forms/{Field.tsx,controls.tsx,fieldContext.ts,Forms.module.css,Field.test.tsx},
modals/{Dialog.tsx,Dialog.module.css,ConfirmDialog.tsx,Dialog.test.tsx},
tables/{Pagination.tsx,Pagination.module.css,rango.ts,Pagination.test.tsx},
feedback/{EmptyState.tsx,ErrorState.tsx,Feedback.module.css}, icons/{Icon.tsx,iconPaths.ts}}`,
`src/styles/tokens.test.ts`, `src/app/dev/UiKitPage.tsx+css`,
`scripts/fase13-rediseno-ui-fixture.mjs`, este documento.

Modificados: `src/styles/tokens.css`, `src/components/ui/Button.tsx+css`,
`src/app/routes.tsx`, `scripts/fase13-rediseno-auditoria.mjs`,
`docs/architecture/ADR-008-estilos-responsive.md` (addendum).

## K. Decisiones pendientes

1. **Logo**: ¿cuál es el archivo oficial? ¿Existe el SVG de origen (del diseñador o del sitio) o se autoriza usar el PNG oficial en el header hasta tenerlo? (No se usarán las vectorizaciones automáticas sin confirmación.)
2. ¿E2 (shell: sidebar agrupada/compacta, header, PageHeader, 404 dentro del shell) es la próxima entrega, como en el plan?
