# FASE 13 — REDISEÑO GLOBAL · ENTREGA 0 — AUDITORÍA UX/UI + DESIGN SYSTEM

> **Sólo análisis y propuesta.** Esta entrega no cambia UI productiva, CSS global, lógica, base de
> datos ni dependencias. El único código nuevo es un script de sólo lectura
> (`scripts/fase13-rediseno-auditoria.mjs`) que mide el CSS/TSX y el bundle.
>
> Base auditada: `main` en `206827b` (Fase 12 cerrada). Fecha: 2026-09-14.

## Cómo se obtuvo la evidencia (y qué NO se pudo ver)

| Fuente | Qué cubre | Marca en la matriz |
|---|---|---|
| **Navegador en E0** (panel Browser, `app.buscatools.com` y `localhost`) | Login, Recuperar contraseña, 404, shell (header/sidebar/drawer) a 390 / 1024 / 1440, foco con teclado, medidas computadas | **V** |
| **Revisiones visuales de fases previas** (prod reviews con fixture zz de Fases 6–12) | Listados, detalles, diálogos y mobile de cada módulo tal como se revisaron al cerrarlos | **V-prev** |
| **Script estático** (`node scripts/fase13-rediseno-auditoria.mjs`) | Colores literales, variables no definidas, escalas reales, clases duplicadas, diálogos, paginadores, íconos, contraste de la paleta, bundle | **M** (medido) |
| **Lectura de código** | Estructura de páginas, componentes repetidos | **E** (a confirmar con captura) |

**Limitación explícita.** Las pantallas con datos (listados, detalles, Emails, Informes) **no se
recapturaron en E0**: la única sesión presente en el navegador es de un usuario fixture de la
Fase 12 ya borrado (sin empresa → los módulos quedan en «Cargando…»), y crear un fixture nuevo
escribe en la base, cosa que esta entrega prohíbe. Por la regla «no declarar problemas sólo por
leer CSS», **todo hallazgo marcado E queda como «a confirmar»** y la **E1 empieza por capturar un
baseline visual con fixture zz** (ver §P y §Q-6) antes de tocar un solo estilo.

Hallazgo lateral (no es de diseño): el `localStorage` del panel de navegador conservaba tokens de
sesión de usuarios fixture ya eliminados (prod y localhost). Son inofensivos (el usuario no existe),
se borró el de localhost para poder ver el Login. Conviene que los scripts de fixture UI
recuerden cerrar sesión en el navegador además de borrar el usuario.

---

## A. Estado visual actual

**Resumen en una línea:** la app es *coherente por herencia pero no por sistema*. Existe una base
de tokens decente (ADR-008, portada del legacy) y todos los módulos la usan, pero **cada módulo
reimplementó sus propios botones, inputs, chips, paginadores, diálogos y estados vacíos**, así que
las diferencias son pequeñas y constantes: se nota «hecho por partes».

Números medidos (M):

| Métrica | Valor |
|---|---|
| Archivos CSS / líneas | **95 / 14 721** (compras 3266 · ventas 2676 · mantenimiento 2377 · clientes 2087 · catálogo 971 · emails 932 · informes 894 · configuración 669 · layouts 256 · styles 238 · components 225) |
| Archivos TSX (sin tests) | 182 |
| Colores literales fuera de `tokens.css` | **105** (51 en las dos vistas de impresión, que son legítimas; ~54 en pantalla) |
| Variables usadas y **no definidas** | `--accent`×8, `--warning-bg`×7, `--surface-soft`×2, `--on-primary`×1 |
| `font-size` distintos | **22** (tokens ×575; px sueltos: 16px×43, 11px×8, 10px×8, 12px×5, 9px×5, 9.5px×5, 26px×3, 22px×3, 13px×3, 20px×2, 14px×2, 8px×2, 8.5px×2, 18px×1…) — casi todos los px sueltos están en impresión; en pantalla, 16px es el anti-zoom de iOS en inputs |
| `font-weight` distintos | 6 (600×124, 700×74, 800×12, 400×8, 500×3, 900×3) |
| `border-radius` distintos | **11** (`--radius-sm`×192, `--radius`×96, 999px×5, 12px×4, 10px×2, 3px×2, 16px×1, 50%…) |
| `box-shadow` | 5 (2 tokens + 3 literales) |
| `min-height` de controles | 44px×196, **32px×7, 36px×7**, 40px×3, 48px×1, 28px×1, 24px×1 |
| `z-index` | 1, 20, 100, 110 literales + 3 tokens |
| Media queries distintas | **17** (640, 560, 767+coarse, 767, 800, coarse, 768, 769, 520, 1099, 599, 1023, 479, 601, 768-min, print, reduced-motion) |
| Clases repetidas en ≥ 4 archivos | `.nota`×41, `.error`×32, `.etiqueta`×25, `.acciones`×25, `.titulo`×22, `.select`×20, `.tabla`×19, `.vacio`×17, `.secundario`×17, `.primario`×14, `.boton`×13… |
| Archivos que definen su propio botón | **42** |
| Archivos que definen su propio input/select | **38** |
| Definiciones propias de estado vacío (`.vacio`) | 17 |
| `<button>` nativos vs `<Button>` compartido | **345 vs 40** |
| Paginadores | **6 componentes `Paginador` distintos** (catálogo, clientes, compras, informes, mantenimiento, ventas) + paginación inline en 17 páginas |
| Diálogos | 8 implementaciones propias; **sólo `configuracion/Dialogo` tiene Escape + foco + `aria-labelledby`** |
| `window.confirm` nativo | 2 (Emails «Descartar borrador», Ventas «Cancelar/Eliminar documento») |
| Tablas | 10 `<ResponsiveTable>` (Catálogo + Configuración + demo) vs **39 archivos con `<table>` nativa**; 16 archivos resuelven mobile a mano con `useIsMobile` |
| Íconos | sin set: flechas unicode `← → ↑ ↓`, `⚠ ✓ ○ ▾ ✕ ▲ ▼ ▣ ★`, emoji 📎, entidad `&#9776;`, 1 SVG inline. `public/favicon.svg` existe pero **no se usa en la UI** |
| Toasts | ninguno |
| Skeletons | ninguno; **80 apariciones de «Cargando…»** en texto plano |
| Dark mode | tokens `:root[data-theme='dark']` existen, pero `index.html` fija `light` y no hay toggle ni se probó módulo por módulo |
| Bundle (build de E0) | JS **1515 kB** en 130 chunks · CSS **210 kB** en 46 chunks · vendor-react 269 kB · vendor-data 252 kB · index 106 kB · InformesPage 80 kB · OrdenDetallePage 62 kB · ClienteDetallePage 48 kB · EmailHiloPage 42 kB |

Lo que **ya está bien** y hay que conservar:
- h1 de página unificado de hecho: todos los `.titulo` de página usan `--text-xl` (24px) + 700 (M).
- Controles táctiles de 44px en la gran mayoría (196 usos) e inputs de 16px en mobile (V en Login: input 50px de alto, 16px).
- Chips de estado con texto + borde (no sólo color) y comentario explícito sobre impresión B/N.
- `focus-visible` presente en inputs (V: outline naranja 1.6px con offset).
- `StatusMessage` compartido (45 usos) y `ResponsiveTable` probado.
- Sin librerías de UI ni de íconos: el bundle de vendors es sólo React + Supabase + Query.

---

## B. Navegación

### Estado actual (V)
- Header oscuro (`--topnav-bg #1a1a1a`, 56px) con ☰ (entidad HTML), texto «BUSCATOOLS», `EmpresaSelector`, email del usuario truncado y botón «Salir» (44px).
- Sidebar blanca 240px con **un único grupo «Módulos»** y hasta **15 ítems planos** para admin:
  Dashboard, Catálogo, Cotizaciones, Pedidos, Notas de entrega, Clientes, Proveedores, Pedidos de compra,
  Notas de entrada, Facturas de proveedor, Equipos, Órdenes de servicio, Emails, Informes, Configuración; más «Próximamente: WhatsApp» deshabilitado.
- Ítems de 45px, 14px (V). Activo: fondo `--primary-light` + texto `--primary-text`.
- Drawer bajo 768px. Comentario en código: «Navegación provisoria de FASE 1».
- Configuración tiene sub-navegación propia (columna interna); Informes usa pestañas (`nav` con clases `pestana`); Mantenimiento tiene «Puntos» sólo accesible desde dentro.
- **No hay breadcrumbs.** Los detalles usan un enlace «← Volver» propio en cada página (≈25 páginas, M por íconos).
- Con sesión sin empresa activa, los módulos quedan en «Cargando…» indefinido (V con la sesión huérfana). Un usuario real siempre tiene membresía, así que el impacto es bajo, pero falta un estado «Sin empresa activa».

### Problemas
1. Lista plana de 15 ítems sin agrupación: «Pedidos» y «Pedidos de compra» quedan separados por 5 ítems y compiten por nombre (P1).
2. Sin íconos en la sidebar → escaneo lento; y en tablet no hay modo compacto posible sin íconos (P2).
3. La sidebar a 768–1023px consume 240px: el contenido queda en ~463px a 768 (V-prev, Fase 12) y las tablas scrollean internamente (P1).
4. Tres patrones de sub-navegación distintos (subnav lateral de Configuración, pestañas de Informes, enlaces sueltos de Mantenimiento) (P2).
5. «Dashboard» es la entrada principal y hoy es una página técnica de Fase 1 (ver §M) (P0 de percepción de producto).

### Propuesta de agrupación (sin tocar permisos: `NAV` sigue filtrado por rol como hoy)

```
Inicio
OPERACIÓN
  Ventas            → Cotizaciones · Pedidos · Notas de entrega
  Compras           → Proveedores · Pedidos · Recepciones · Facturas
  Mantenimiento     → Equipos · Órdenes · Puntos
DATOS
  Catálogo
  Clientes
COMUNICACIÓN
  Emails
  WhatsApp (próximamente, deshabilitado)
ANÁLISIS
  Informes
ADMINISTRACIÓN
  Configuración
```

- Grupos con título pequeño (label 12px, `--text-muted` corregido, mayúsculas con tracking).
- Módulos con hijos: **acordeón** (se expande el grupo de la ruta activa; los demás colapsados). No hay «megamenú».
- Grupos vacíos para el rol se ocultan (hoy ya se filtra ítem por ítem; el grupo se deriva).
- Los nombres de ítems hijos se acortan dentro de su padre («Pedidos» bajo Compras en lugar de «Pedidos de compra»), manteniendo el título completo en el `PageHeader`.

---

## C. Layout

| Rango | Hoy (V) | Propuesta |
|---|---|---|
| **≥ 1024px** | Header 56 + sidebar 240 fija + main padding 24 | Igual estructura. Sidebar 240 con grupos; contenido con **max-width por tipo de página**: listados fluidos (hasta 1440), detalles/formularios 1100, configuración 960. Padding main 24/32 |
| **768–1023px** | Sidebar 240 fija (contenido ~463–783px) | **Sidebar compacta 64px** (sólo íconos + tooltip + `aria-label`), expandible en overlay. Recupera ~176px |
| **< 768px** | Drawer con ☰ | Drawer igual, con foco atrapado y cierre con Escape/overlay (verificar hoy) y la agrupación nueva |

Reglas:
- **Nunca scroll horizontal del `body`.** Sólo contenedores de tabla con `overflow-x:auto` (ya existe `.scroll-x`).
- Header sticky; sidebar sticky con scroll propio.
- Una sola escala de breakpoints (§K) en lugar de 17 media queries.

### Header propuesto
`[☰ sólo <1024] [logo + BUSCATOOLS] ········ [Empresa activa ▾] [avatar/iniciales ▾ (email, Salir)]`

- Empresa activa **visible siempre** (es contexto crítico en multiempresa: Buscatools / Torquetools).
- Usuario en menú (hoy email crudo truncado + botón «Salir» ocupan ancho).
- **Búsqueda global: no existe hoy** → no se propone implementarla en el rediseño; queda reservado el hueco (§Q).
- Acciones contextuales **no** van en el header global: van en el `PageHeader` de cada página.

---

## D. Branding

| Elemento | Estado (V/M) | Problema | Propuesta |
|---|---|---|---|
| Logo | No hay logo en UI: texto «BUSCATOOLS» en header (blanco) y en Login (naranja, 700) | Marca sin identidad gráfica | Usar `favicon.svg`/isotipo existente como logo en header y Login; wordmark tipográfico hasta que haya logo oficial (§Q-5) |
| Favicon | `favicon.svg` + `icon-192/512` + manifest, `theme-color #F37021` | OK | Mantener |
| Nombre | «BUSCATOOLS» en mayúsculas en todos lados; Login dice «Sistema de gestión BUSCATOOLS» | Gritón; no hay nombre de producto | Wordmark «Buscatools» o «BUSCATOOLS ERP» — decisión §Q-5 |
| Color de marca | `--primary #f37021`; Catálogo usa **otro naranja** `--accent` no definido con fallback `#d9600a` (M) | Dos naranjas | Un solo naranja + escala (§E) |
| Login | Card 358px, radius 12, h1 18px/700, input radius **8** vs botón radius **4**, botón deshabilitado a opacidad .55 (blanco sobre naranja lavado), link «¿Olvidaste tu contraseña?» 12px naranja con **16px de alto** (V) | Pequeño y genérico; incoherencias de radio; link difícil de tocar; contraste bajo | §M Login |
| Empresa | Configuración → Empresa ya maneja logo por empresa (bucket privado) | No se aprovecha en el shell | Opcional: logo de la empresa activa en el selector (no en E1) |

---

## E. Tokens y paleta

### Diagnóstico de la paleta actual (M: WCAG 2.1)

| Par | Ratio | Resultado |
|---|---|---|
| `--text #1a1a1a` / `--bg #f5f5f5` | 15.96 | AA |
| `--text-soft #6b6b6b` / `--surface` | 5.33 | AA |
| `--text-soft` / `--bg` | 4.89 | AA justo |
| **`--text-muted #999` / `--surface`** | **2.85** | **Falla** (se usa para labels de grupo, hints, chips «pendiente») |
| **`#fff` / `--primary #f37021`** (botón primario) | **2.94** | **Falla** para texto de 14px |
| `#fff` / `--primary-hover #d85518` | 4.01 | Sólo texto grande |
| **`--primary` como texto sobre blanco** (links «Volver al inicio», «¿Olvidaste…?») | **2.94** | **Falla** |
| `--primary-text #b8430e` / `--primary-light` | 5.01 | AA |
| **`--success #28a745` / `--success-light`** (chip «ok/entregado») | **2.52** | **Falla** |
| `--success` / blanco | 3.13 | Sólo grande |
| `--warning-text` / `--warning-light` | 5.13 | AA |
| `--danger #dc3545` / blanco | 4.53 | AA justo |
| `--border #e5e5e5` / `--surface` | 1.26 | Bordes de input casi invisibles (WCAG 1.4.11 pide 3:1 para límites de controles) |

Faltan: `--info` (+ soft/text), `--danger-light`/`--danger-text`, `--success-text`, sombras con escala,
line-heights, pesos, z-index completo, duraciones. Las 4 variables no definidas (`--accent`,
`--warning-bg`, `--surface-soft`, `--on-primary`) caen a fallback o a herencia: `PanelEtapas`
`.primario` usa `color: var(--on-primary)` **sin fallback** → el texto hereda color oscuro sobre
naranja, distinto de todos los demás botones primarios (M).

### Paleta propuesta (light) — naranja como acento, no como fondo

Principio: **naranja = acción primaria, foco y estado activo de navegación.** Todo lo demás es
neutro. Texto sobre naranja sólo en tamaños ≥ 14px/600 **usando el naranja oscuro**, o texto
oscuro sobre naranja claro.

| Token | Valor | Uso | Contraste verificado |
|---|---|---|---|
| `--color-brand-500` | `#f37021` | Marca: logo, indicador activo, foco, gráficos | decorativo / UI (no texto) |
| `--color-primary` | `#c2410c` | Fondo de botón primario | `#fff` 5.18 → AA |
| `--color-primary-hover` | `#9a3412` | Hover primario | `#fff` 7.3 → AA |
| `--color-primary-soft` | `#fff4ec` | Fondo de ítem activo, chip «info/marca» | `--color-primary-text` encima: 5.04 |
| `--color-primary-text` | `#b8430e` (actual) | Links y texto de marca sobre blanco/soft | 5.46 / 5.01 → AA |
| `--color-bg` | `#f6f6f5` | Fondo de app | — |
| `--color-surface` | `#ffffff` | Cards, tablas, paneles | — |
| `--color-surface-alt` | `#fafaf9` | Header de tabla, zebra, filtros | — |
| `--color-border` | `#e4e4e2` | Separadores | decorativo |
| `--color-border-strong` | `#8f8f8c` | **Borde de inputs y controles** | 3.24 sobre blanco (1.4.11 ≥ 3) |
| `--color-text` | `#1a1a1a` | Texto principal | 17.4 |
| `--color-text-soft` | `#525250` | Secundario, labels | 7.83 sobre blanco |
| `--color-text-muted` | `#6b6b68` | Hints, metadatos (reemplaza `#999`) | 5.35 blanco · 4.94 bg · 4.86 neutral-soft → AA |
| `--color-success` / `-soft` / `-text` | `#16a34a` / `#ecfdf3` / `#166534` | Estados OK | text/soft 6.76 → AA |
| `--color-warning` / `-soft` / `-text` | `#d97706` / `#fffbeb` / `#92400e` | Revisión, avisos | text/soft 6.84 → AA |
| `--color-danger` / `-soft` / `-text` | `#dc2626` / `#fef2f2` / `#991b1b` | Error, cancelado, destructivo | `#fff`/danger 4.83; text/soft 7.60 → AA |
| `--color-info` / `-soft` / `-text` | `#2563eb` / `#eff6ff` / `#1e40af` | Información, «enviado» | text/soft 8.01 → AA |
| `--color-neutral-soft` / `-text` | `#f4f4f3` / `#52524f` | Borrador, inactivo | 7.12 → AA |
| `--color-topnav-bg` | `#1a1a1a` (o blanco, §Q-1) | Header | — |

> Ratios medidos en E0 con la misma fórmula WCAG del script (`--color-text-soft` #525250 = 7.83).
> En E1 se agregan estos pares a la tabla del script para que la verificación quede
> automatizada. Nota: `#737370` se descartó para muted porque sobre `--color-bg` da 4.40 (falla).
>
> Migración **por alias**, no por reemplazo masivo: en E1 los tokens viejos (`--primary`,
> `--text-muted`, …) pasan a apuntar a los nuevos, así los 95 archivos cambian de color sin editar
> cada uno; los módulos se limpian de a uno en E2–E5.

### Escalas (sin valores al azar)

| Categoría | Tokens |
|---|---|
| **Espaciado** (base 4) | `--space-0 0` · `--space-1 4px` · `--space-2 8px` · `--space-3 12px` · `--space-4 16px` · `--space-5 20px` · `--space-6 24px` · `--space-8 32px` · `--space-10 40px` · `--space-12 48px`. Los actuales `--space-5 1.5rem` y `--space-6 2rem` se **renombran** en E1 con alias para no romper (hoy `--space-5` = 24px) |
| **Radius** | `--radius-sm 4px` (chips cuadrados, checkbox) · `--radius-md 6px` (**botones e inputs, iguales**) · `--radius-lg 10px` (cards, diálogos) · `--radius-full 999px` (pills, avatares). Se eliminan 3px/10px/12px/16px literales |
| **Sombras** | `--shadow-xs` (hover de fila/card) · `--shadow-sm` (cards) · `--shadow-md` (menús, popovers) · `--shadow-lg` (diálogos, drawer). Sin sombras literales |
| **Bordes** | `--border-width 1px` · `--focus-ring: 0 0 0 3px color-mix(brand 35%)` + outline 2px `--color-brand-500` |
| **Font size** | `--text-xs 12px` · `--text-sm 14px` · `--text-md 16px` · `--text-lg 18px` · `--text-xl 20px` · `--text-2xl 24px`. **Prohibido < 12px en pantalla** (hoy hay 8–11px fuera de impresión) |
| **Font weight** | `--weight-regular 400` · `--weight-medium 500` · `--weight-semibold 600` · `--weight-bold 700`. Se eliminan 800/900 |
| **Line height** | `--leading-tight 1.25` (títulos) · `--leading-normal 1.5` (texto) · `--leading-table 1.35` |
| **Z-index** | `--z-base 0` · `--z-sticky 10` (thead, barras sticky) · `--z-header 100` · `--z-dropdown 150` · `--z-drawer 200` · `--z-modal 300` · `--z-toast 400`. Se eliminan 1/20/110 literales |
| **Duraciones** | `--duration-fast 150ms` · `--duration-base 200ms` · `--ease-standard cubic-bezier(.2,0,0,1)`; `prefers-reduced-motion` → 0 |
| **Breakpoints** | ver §K (`390 / 430 / 768 / 1024 / 1440`) — como constantes de documentación y `@custom-media` si se adopta PostCSS; hoy CSS Modules no admite variables en media queries, así que se fijan **4 valores literales permitidos**: `max-width: 767px`, `min-width: 768px`, `min-width: 1024px`, `min-width: 1440px` |

### Dark mode
Existe base (`:root[data-theme='dark']` en `tokens.css`) pero **no se expande**: E1 mantiene el
bloque dark sincronizado con los nombres nuevos (alias) para no romperlo, sin toggle ni QA por
módulo. Queda como decisión futura (§Q).

---

## F. Tipografía

Fuente: mantener **`system-ui`** (0 kB, nativa en Windows/Android/iOS). No se propone webfont
(sería +20–40 kB y un FOUT) salvo decisión de marca (§Q-5).

| Rol | Tamaño / peso / line-height | Uso | Hoy |
|---|---|---|---|
| **H1** página | 24px / 700 / 1.25 | Título del `PageHeader` | 24px/700 en todos los módulos ✔ (Login usa 18px) |
| **H2** sección | 18px / 600 / 1.3 | Título de card/panel | Varía: `--text-lg`, `--text-base`, `--text-sm` según módulo (E) |
| **H3** subsección | 16px / 600 / 1.35 | Grupos dentro de un panel | Varía (`.h3` propia en Clientes) |
| **Body** | 14px / 400 / 1.5 | Texto general (densidad ERP) | 14px ✔ |
| **Small** | 13px→ **12px** / 400 / 1.45 | Metadatos, ayudas | `--text-xs` 12px ✔ + literales 9–11px ✘ |
| **Label** | 13px / 600 / 1.3, `--text-soft` | Label de campo | 14px/600 en Login; `.etiqueta` ×25 con variantes |
| **Table** | 14px cuerpo; header 12px / 600 / uppercase opcional, `--text-soft` | Tablas | Varía por módulo (E) |
| **Caption** | 12px / 500, `--text-muted` | Totales de paginador, notas al pie | `.nota` ×41 variantes |
| **Números** | `font-variant-numeric: tabular-nums` | Importes, cantidades, stock, fechas en tablas | Parcial (E) |

---

## G. Componentes — inventario y especificación

### G.1 Inventario de piezas repetidas (M)

| Pieza | Implementaciones hoy | Propuesta | Riesgo de sobre-abstraer |
|---|---|---|---|
| Botón | `Button` compartido (40 usos) + **42 archivos** con `.primario/.secundario/.peligro/.boton/.nuevo` | `Button` único (variants + sizes + loading) e `IconButton` | Bajo |
| Input / Select / Textarea | **38 archivos** con `.input/.control/.select` | `Field` + `Input` / `Select` / `Textarea` / `Checkbox` / `Switch` | Bajo |
| Chip de estado | `ChipEstado` ×3 (ventas, compras, mantenimiento — CSS casi idéntico copiado) + chips locales en Configuración | `Badge` (tono) + **mapas de estado por módulo** (`estadoVenta → {tono, texto}`) | Medio: el mapa se queda en el módulo |
| Paginador | **6 componentes** + inline en 17 páginas; textos distintos («1–50 de 120», «Página 2»…) y el bug «1 eventos» | `Pagination` único (anterior/siguiente + rango + pluralización) | Bajo |
| Diálogo | 8 implementaciones; 1 con foco/Escape | `Dialog` único (confirm/form/danger/info) sobre `<dialog>` nativo o portal con focus trap | Bajo |
| Confirmación | `window.confirm` ×2 | `ConfirmDialog` | Bajo |
| Page header | `.encabezado` + `.titulo` + botón «+ Nuevo» por página; «← Volver» ×25 | `PageHeader` (título, subtítulo, back/breadcrumb, acciones) | Bajo |
| Filtros | `FiltrosDocumentos`, `FiltrosPedidos`, `FiltrosProveedores`, `FiltrosActivos`, `FiltrosOrdenes`, `FiltrosClientes`, `FiltrosEmails`, filtros de Auditoría, `PanelFacetas` | `FilterBar` **de layout** (contenedor + slots + «Limpiar» + colapso mobile). Los campos siguen siendo de cada módulo | **Alto** si se intenta un FilterBar con config JSON: no hacerlo |
| Tabla | `ResponsiveTable` (10) + `<table>` nativa (39) + cards a mano con `useIsMobile` (16) | Primitivas de estilo `Table/THead/TR/TD` + `ResponsiveTable` para listados simples; las grillas editables (líneas de documento, recepción, factura) quedan propias | **Alto**: no crear `<DataTable everything>` |
| Estado vacío | `.vacio` ×17 | `EmptyState` (ícono opcional, título, texto, CTA) | Bajo |
| Carga | «Cargando…» ×80 | `Spinner` inline + `Skeleton` de filas para listados + `Button loading` | Bajo |
| Error | `StatusMessage tono=error` + `role=alert` + «Reintentar» en algunos | `InlineError` (campo), `ErrorState` (página/panel con Reintentar) | Bajo |
| Card / panel | `.panel`×17, `.caja`, `.seccion`, `.resumen`… | `Card` (+ `CardHeader`), `MetricCard` | Bajo |
| Tabs | Informes (`pestana`), Configuración (subnav), detalles con paneles | `Tabs` accesible (`role=tablist`) — hoy **0** usos de `role=tab` (M) | Medio |
| Toast | no existe | `Toast` mínimo (§G.13) | — |
| Íconos | unicode/emoji mezclados | set propio SVG (§G.14) | — |

### G.2 PageHeader
```
[← Pedidos]  (o breadcrumb Ventas / Pedidos / PED-00123)
Pedido PED-00123   [Chip Confirmado]              [Secundaria] [Secundaria] [Primaria]
Cliente ACME SA · 14/09/2026                      (en mobile: primaria full-width + menú ⋯)
```
- Props: `title`, `subtitle?`, `back?: {to,label}` **o** `breadcrumbs?`, `status?: ReactNode`, `actions?: ReactNode` (máx. 1 primaria + 2 secundarias visibles; resto en menú ⋯).
- h1 único por página. Margen inferior `--space-6`.
- Mobile: título arriba, acciones debajo; primaria ancho completo.

### G.3 Botones
| Variante | Fondo / texto / borde | Uso |
|---|---|---|
| **Primary** | `--color-primary` / blanco | 1 por vista: Guardar, Emitir, Nuevo |
| **Secondary** | surface / text / `--color-border-strong` | Acciones normales |
| **Ghost** | transparente / `--color-text-soft`; hover `surface-alt` | Terciarias, acciones de fila |
| **Danger** | `--color-danger` / blanco (confirmación) · `danger-text` sobre transparente (disparador) | Eliminar, Cancelar documento |
| **IconButton** | cuadrado, `aria-label` obligatorio | Cerrar, ⋯, expandir |

- Alturas: **`md` 40px desktop / 44px en `pointer: coarse`**, `sm` 32px sólo desktop dentro de tablas/grillas densas (hoy hay 32/36 literales en 11 archivos: se normalizan a `sm`), `lg` 48px (Login, CTA mobile).
- Padding horizontal 16 (`md`), 12 (`sm`). Radius `--radius-md`. Peso 600.
- Estados: hover (bg −1 paso), active (−2 pasos), **focus-visible con `--focus-ring`**, disabled (**no** opacidad .55 sobre naranja: fondo `neutral-soft` + texto `text-muted` corregido + `cursor:not-allowed`), loading (spinner 16px + texto se mantiene + `aria-busy` + deshabilitado).
- Texto de botón: verbo + objeto («Nuevo pedido»); **sin «+ »** textual: el «+» pasa a ícono.

### G.4 Tabla
- Contenedor `Card` sin padding; `thead` `surface-alt`, texto 12px/600 `text-soft`, sticky (`--z-sticky`) en tablas largas.
- Filas 44px (comfortable), hover `surface-alt`, seleccionada `primary-soft` + borde izquierdo brand 3px (ya usado en un inset de Configuración).
- Números a la derecha con `tabular-nums`; fechas `dd/mm/aaaa`; textos largos con truncado + `title`.
- Columna de acciones a la derecha: 1 acción visible (ghost) + menú ⋯.
- Pie: `Pagination` (rango «1–50 de 1.234 pedidos», singular/plural correcto, anterior/siguiente 44px).
- Estados: loading = skeleton de 5 filas manteniendo altura; empty = `EmptyState` dentro de la card; error = `ErrorState` con Reintentar.
- `keepPreviousData` ya existe: mostrar indicador sutil de «actualizando» en el header de la tabla en lugar de vaciarla.

### G.5 Tablas en mobile (regla)
| Tipo de tabla | Mobile |
|---|---|
| Listado de entidades (pedidos, clientes, equipos, proveedores, auditoría) | **Cards** (patrón `ResponsiveTable`): título + chip + 2–4 pares clave/valor + acción |
| Grilla editable (líneas de documento, recepción, factura, repuestos) | **Filas apiladas** por ítem con controles 44px; nada de tabla con scroll para editar |
| Tabla analítica (Informes, stock, kardex, precios) | **Scroll horizontal interno** en su contenedor, primera columna sticky |
| Nunca | Scroll horizontal del `body` |

### G.6 Cards
- **BaseCard**: surface, `--radius-lg`, borde `--color-border`, `--shadow-xs`, padding 16/20.
- **MetricCard**: label (caption), valor 24px/700 tabular, delta opcional con ícono + texto (nunca sólo color), link «Ver».
- **ActionCard**: ícono + título + descripción corta + área clickeable completa (accesos rápidos del dashboard).
- **DetailCard**: `CardHeader` (h2 + acción) + lista de definiciones (`dl`) en 2 columnas ≥ 768, 1 en mobile.

### G.7 FilterBar
- Desktop: una fila `wrap` → búsqueda (flex 1, ícono lupa, min 240px) · 2–3 selects · rango de fechas · «Limpiar» (ghost, sólo si hay filtros activos) · «Más filtros» (abre panel) si hay más de 4 campos.
- Mobile: búsqueda visible + botón «Filtros (n)» que abre **drawer inferior** con los campos y «Aplicar / Limpiar».
- Chips de filtros activos debajo (patrón que Catálogo ya usa en `PanelFacetas`).
- Los filtros siguen siendo del módulo (el componente es sólo layout).

### G.8 Formularios
- `Field` = `Label` (+ «(opcional)» en vez de asterisco rojo) + control + `Help` + `Error` (`aria-describedby`, `aria-invalid`).
- Controles: altura 40 desktop / 44 coarse, **font 16px en mobile**, radius `--radius-md`, borde `--color-border-strong`.
- Estados: normal · hover (borde text-soft) · **focus** (borde brand + `--focus-ring`) · **error** (borde danger + mensaje con ícono) · **disabled** (surface-alt, texto muted) · **readonly** (sin borde, fondo `--input-readonly-bg`, seleccionable — hoy existe el token).
- Checkbox/Switch 20px con área táctil 44px. Select nativo estilizado (no se propone combobox custom salvo buscadores que ya existen: `BuscadorCliente`, `BuscadorProveedor`, `SelectorProducto`).
- Layout: 1 columna mobile; 2 columnas ≥ 768 para formularios largos (Cliente, Proveedor, Equipo); acciones al pie sticky en mobile.

### G.9 Diálogos
| Tipo | Contenido | Botones |
|---|---|---|
| Confirm | título + texto | Cancelar (secondary) · Confirmar (primary) |
| Form | título + campos | Cancelar · Guardar (primary, loading) |
| Danger | título + consecuencia explícita («No se puede deshacer») | Cancelar · Eliminar (danger) — foco inicial en **Cancelar** |
| Info | título + texto | Entendido |

- Requisitos: `role="dialog"` + `aria-modal` + `aria-labelledby`, **focus trap**, foco inicial, **Escape**, click fuera (no en form con cambios), devolver foco al disparador, scroll del body bloqueado.
- Mobile < 768: hoja inferior a ancho completo, acciones sticky abajo.
- Base recomendada: el `Dialogo` de Configuración (único que ya cumple Escape + foco + labelledby) generalizado.
- Reemplaza los 2 `window.confirm` y los modales de impresión/entrega parcial.

### G.10 Badges / estados
Un `Badge` con **tono** y **texto**; el módulo decide el mapeo. Forma: pill `--radius-full`, 12px/600, padding 2×8, borde 1px del tono (se conserva la regla actual de legibilidad en B/N), **punto o ícono opcional** para no depender del color.

| Estado de negocio | Tono | Nota |
|---|---|---|
| Borrador | neutral | |
| Enviado / Emitido | info | |
| Confirmado | primary-soft (marca) | |
| En revisión / Pendiente / Parcial | warning | «pendiente» hoy es `text-muted` punteado (2.85, falla) |
| Entregado / Recibido / Completo | success | hoy `success` sobre `success-light` = 2.52, falla |
| Cancelado / Anulado | danger (outline) | se mantiene outline |
| Activo | success | |
| Inactivo / Suspendido | neutral | |

### G.11 Colores de estado — regla
`success / warning / danger / info / neutral`, **cada uno con `-soft` (fondo) y `-text` (texto AA)**. Nunca color solo: siempre texto, y en alertas/errores un ícono.

### G.12 Vacíos, carga y errores
- **EmptyState**: ícono (opcional, 32px, muted) · título («Todavía no hay pedidos») · explicación de 1 línea (qué es / por qué está vacío, distinguiendo «sin datos» de «sin resultados para estos filtros») · CTA si el rol puede crear, **o** «Limpiar filtros».
- **Loading**: skeleton para listados y detalles (bloques con la forma final); spinner sólo en acciones puntuales; botones con `loading`. Nunca página en blanco con «Cargando…» (V en carga de rutas lazy y en Login).
- **Error**: inline en campo · `ErrorState` en panel/página con «Reintentar» · toast para fallos de acciones rápidas. Mensajes humanos (ya se traduce `42501`/`datos_invalidos` en varios módulos); **nunca stacktrace ni código crudo** — `ErrorPage.tsx` usa 7 estilos inline y hay que revisar que no muestre `error.message` técnico (E).

### G.13 Toasts (auditoría + propuesta; no implementar en E1)
- Hoy: **no existen** (M). Las confirmaciones de éxito son `StatusMessage` inline o nada.
- Propuesta mínima: región `aria-live="polite"` abajo a la derecha (arriba en mobile), 4s, máx. 3, tipos success/error/info, con acción opcional («Deshacer» sólo si la lógica ya lo soporta — hoy no). **Sin librería.** Sólo para confirmaciones de acciones que no cambian de pantalla (guardar cambios, copiar, reenviar invitación). Los errores bloqueantes siguen inline.

### G.14 Íconos
- Hoy: flechas unicode, `⚠ ✓ ○ ▾ ✕ ▲ ▼ ▣ ★`, emoji 📎 (Emails), entidad `&#9776;`, 1 SVG inline (M). Los glifos unicode cambian de forma según SO/fuente y 📎 se renderiza como emoji a color.
- Propuesta: **un set propio de ~30 SVG inline** en `src/components/icons/` (stroke 1.75, 20px, `currentColor`, `aria-hidden` salvo IconButton), dibujados con la geometría de un set libre (Lucide, licencia ISC) **copiando sólo los paths necesarios**, no instalando el paquete. Coste estimado < 6 kB.
- Lista inicial: menu, chevron-left/right/down, arrow-up/down (orden), x, plus, search, filter, calendar, check, circle, alert-triangle, info, paperclip, star, more-horizontal, external-link, printer, mail, download, upload, trash, edit, eye, home, shopping-cart, truck, package, wrench, users, bar-chart, settings, message-circle, log-out, building.

---

## H. Tablas — hallazgos

| # | Hallazgo | Ev. | Sev. |
|---|---|---|---|
| H1 | Tres formas de resolver tablas: `ResponsiveTable` (Catálogo/Config), `<table>` nativa con cards a mano vía `useIsMobile` (Ventas, Compras, Mantenimiento, Clientes), `<table>` con scroll (Informes) | M | P1 |
| H2 | 6 paginadores con textos y alineaciones distintas; «1–1 de 1 eventos» en Auditoría | M + V-prev | P1 / P3 |
| H3 | A 768px con sidebar 240 el área útil es ~463px: las tablas de listados scrollean horizontalmente dentro de su contenedor | V-prev | P1 |
| H4 | Headers de tabla con estilos distintos por módulo (`.tabla`×19 definiciones) | M/E | P2 |
| H5 | Chips de estado «ok» y «pendiente» con contraste insuficiente | M | P1 (a11y) |
| H6 | Orden por columna con flechas unicode `↑ ↓` sin `aria-sort` verificado | M/E | P2 |
| H7 | Sin skeleton: al paginar/filtrar, «Cargando…» o salto de alto | M/E | P2 |

## I. Formularios — hallazgos

| # | Hallazgo | Ev. | Sev. |
|---|---|---|---|
| I1 | 38 archivos definen su propio input/select; radios distintos (Login: input 8px vs botón 4px) | M + V | P1 |
| I2 | Borde de input `#e5e5e5` (1.26:1): el límite del campo casi no se ve | M + V | P1 (a11y 1.4.11) |
| I3 | Botón deshabilitado por opacidad .55 sobre naranja (Login «Ingresar» antes de completar): parece roto y el texto blanco queda ~1.8:1 | V | P1 |
| I4 | Controles de 32/36px en 11 archivos (grillas de líneas, buscadores, Informes, Composer): OK en desktop denso, hay que confirmar que en `pointer: coarse` suben a 44 | M/E | P2 |
| I5 | Labels con 25 variantes de `.etiqueta` (tamaño/peso/color) | M | P2 |
| I6 | Anillo de foco naranja 1.6px (`#f37021` sobre blanco 2.94:1) apenas bajo el 3:1 | V + M | P2 |

## J. Diálogos — hallazgos

| # | Hallazgo | Ev. | Sev. |
|---|---|---|---|
| J1 | 8 implementaciones; 7 sin manejo de Escape ni foco inicial; `SelectorProducto` ×3 con `role=dialog` sin `aria-modal` | M | **P0** (teclado: un usuario de teclado queda detrás del modal) |
| J2 | `window.confirm` nativo para **Eliminar/Cancelar documento** (Ventas) y **Descartar borrador** (Emails): no se puede estilizar, no explica consecuencia con formato, en mobile se ve como alerta del sistema | M | P1 |
| J3 | Modales de impresión/entrega parcial con fondo `rgba(0,0,0,.45/.5/.55)` literales distintos | M | P3 |

---

## K. Responsive

Breakpoints oficiales y qué se prueba en cada uno:

| Ancho | Dispositivo | Layout | Comprobar |
|---|---|---|---|
| **390** | iPhone 12–15 | drawer, cards, acciones full-width | sin scroll horizontal del body; inputs 16px; targets 44 |
| **430** | iPhone Pro Max / Android grande | igual que 390 | chips y PageHeader no parten mal |
| **768** | tablet vertical | **sidebar compacta 64px** (propuesta) | tablas: cards o scroll interno según §G.5 |
| **1024** | tablet horizontal / laptop chica | sidebar 240 | filtros en una fila; detalle en 2 columnas |
| **1440** | desktop | sidebar 240, max-width por tipo de página | que los listados no queden estirados a 1200px de ancho sin necesidad |

Hallazgos:
- **17 media queries distintas** (640, 560, 520, 479, 599, 601, 767, 768, 769, 800, 1023, 1099…) → comportamientos que cambian a anchos arbitrarios (M). P1.
- Mezcla de `max-width: 768px` y `min-width: 768px` → **a exactamente 768px se aplican ambos o ninguno** según archivo (M: `(max-width: 768px)`×4 junto a `(min-width: 768px)`×1 y `(min-width: 769px)`×4). P2.
- 390px (V): Dashboard y shell sin scroll horizontal; header con ☰ + marca + «Salir» correcto; 404 sin shell.
- Login 390 (V): card 358px ancho, inputs 50px/16px ✔; link de recuperación 16px de alto ✘.
- Pantallas con datos en 390/430: **pendiente de captura baseline** (E1-0).

## L. Accesibilidad

| # | Hallazgo | Ev. | Sev. |
|---|---|---|---|
| L1 | Diálogos sin focus trap/Escape (J1) | M | P0 |
| L2 | Botón primario blanco sobre `#f37021` = 2.94:1 (falla AA en todas las acciones primarias) | M | P1 |
| L3 | `--text-muted #999` = 2.85:1 en metadatos, labels de grupo del sidebar, hints | M + V | P1 |
| L4 | Links naranja sobre blanco/gris (404 «Volver al inicio», Login «¿Olvidaste tu contraseña?») = 2.94 (blanco) / 2.69 (bg) | V | P1 |
| L5 | Chip success 2.52:1; chip pendiente 2.85:1 | M | P1 |
| L6 | Bordes de input 1.26:1 | M | P1 |
| L7 | Link de recuperación 12px con área táctil de 16px | V | P2 |
| L8 | 0 `role="tablist"` en navegación por pestañas (Informes) | M | P2 |
| L9 | Íconos unicode leídos por lectores de pantalla («flecha izquierda Volver») cuando no llevan `aria-hidden` | M/E | P2 |
| L10 | Carga de ruta lazy: pantalla en blanco con «Cargando…» sin `role="status"` | V | P2 |
| L11 | `prefers-reduced-motion` presente sólo 1 vez | M | P3 |
| ✔ | h1 en pantallas de denegación (corregido en F12), `aria-expanded/controls` en Auditoría, `role=alert` en errores (varios), `lang="es-AR"`, `focus-visible` en inputs | V-prev + M | — |

---

## M. Revisión por módulo

### Inventario de rutas

Leyenda: **L** listado · **D** detalle · **F** formulario · **T** tabla nativa · **RT** ResponsiveTable · **C** cards mobile a mano · **Dlg** diálogo propio.

| Ruta | Pantalla | Layout | Tabla/cards | Filtros | Formularios | Modales | Acciones | Mobile | Problemas visuales (ev.) |
|---|---|---|---|---|---|---|---|---|---|
| `/auth/login` | Login | AuthLayout card 380 | — | — | email + contraseña | — | Ingresar, recuperar | ✔ card fluida | marca de texto, radios mezclados, disabled lavado, link 12px (V) |
| `/auth/recuperar` | Recuperar | AuthLayout | — | — | email | — | Enviar enlace | ✔ | igual Login (V) |
| `/auth/definir-contrasena` | Definir contraseña | AuthLayout | — | — | 2 contraseñas | — | Guardar | ✔ | 2 estilos inline (M) |
| `/` | Dashboard | AppLayout | RT demo | — | — | — | «Ver» demo | ✔ cards | **placeholder técnico de Fase 1**: «Conexión a Supabase», tabla de ejemplo con «Cliente Demo A» (V) |
| `*` | 404 | **sin shell** | — | — | — | — | Volver al inicio | ✔ | texto «todavía no fue migrada», link 2.6:1 (V) |
| `/catalogo` | Catálogo | L + panel facetas + galería | RT | búsqueda + facetas + chips | — | galería (Dlg) | ver producto | RT cards | naranja `#d9600a` distinto; 7 variables no definidas; radios 999/12 (M) |
| `/catalogo/:sku` | Producto | D max 900 | atributos | — | — | galería | volver | ✔ | «← Volver» propio (M) |
| `/ventas/{cotizaciones,pedidos,entregas}` | Listados de venta | L | T + C | `FiltrosDocumentos` | — | — | «+ Nueva» | C | «+ Nueva» visible a salesperson/technician sin permiso (deuda F12); paginador propio (M/V-prev) |
| `/ventas/cotizaciones/nueva`, `pedidos/nuevo`, `entregas/nueva` | Nuevo documento | F | EditorLineas (T) | — | cabecera + líneas + selector producto | SelectorProducto (Dlg) | Guardar | filas apiladas parcial | botones 32/36px en grilla (M) |
| `/ventas/cotizaciones/:id`, `pedidos/:id`, `entregas/:id` | Detalle de documento | D + paneles (stock, pendientes, relacionados, adjuntos) | TablaLineas (T) | — | edición en borrador | ModalImpresion, ModalEntregaParcial (Dlg), `window.confirm` | emitir, convertir, imprimir, cancelar, eliminar | parcial | banner STEL + avisos históricos + chips + acciones: **cabecera muy cargada** (V-prev); confirm nativo (M) |
| `/clientes` | Clientes | L | T + C | `FiltrosClientes` | — | — | «+ Nuevo cliente» | C | paginador propio; ⚠ unicode (M) |
| `/clientes/nuevo`, `/clientes/:id` | Cliente | D con paneles (resumen, contactos, direcciones, historial, memoria, precios, relacionados, gráfico) | varias T | — | FormularioCliente, EditorContactos | — | editar, memoria | parcial | **8 paneles** apilados sin tabs; `--warning-bg` indefinido; bundle 48 kB (M/V-prev) |
| `/compras/proveedores` (+nuevo, :id) | Proveedores | L / D | T + C | `FiltrosProveedores` | FormularioProveedor | — | nuevo, editar | C | 3266 líneas CSS, el módulo más grande (M) |
| `/compras/pedidos` (+nuevo, :id) | Pedidos de compra | L / D | T + C / EditorLineas | `FiltrosPedidos` | cabecera + líneas | ModalImpresionCompras, SelectorProducto | emitir, imprimir | C | chips copiados de Ventas (M) |
| `/compras/recepciones` (+nueva, :id) | Notas de entrada | L / D | T + C / GrillaRecepcion | sí | grilla de recepción | — | recibir | C | grilla editable densa (E) |
| `/compras/facturas` (+nueva, :id) | Facturas proveedor | L / D | T + C / GrillaFactura | sí | grilla + líneas libres | — | registrar | C | ← → unicode en navegación (M) |
| `/mantenimiento/activos` (+nuevo, :id) | Equipos | L / D | T + C | `FiltrosActivos` | FormularioActivo | — | nueva orden | C | |
| `/mantenimiento/ordenes` (+nueva, :id) | Órdenes de servicio | L / D con etapas, checks, torque, repuestos, cotización, cierre, adjuntos | T + C | `FiltrosOrdenes` | varios paneles | SelectorProducto | avanzar etapa, cerrar | parcial | `--on-primary` indefinido en PanelEtapas; ✓ ○ unicode; bundle 62 kB (M) |
| `/mantenimiento/puntos` | Puntos | L | T | — | — | — | — | scroll | accesible sólo desde dentro (E) |
| `/emails` | Bandeja | L estilo cliente de correo | lista propia | `FiltrosEmails` | — | — | abrir, redactar | ✔ | 📎 emoji; ← → paginación propia (M) |
| `/emails/:threadId` | Hilo | D + PanelCliente + PanelTrabajo | — | — | Composer | `window.confirm` descartar | responder | parcial | ★ unicode (M) |
| `/emails/redactar`, `/emails/borradores` | Redactar / Borradores | F / L | — | — | Composer | confirm | enviar | ✔ | botones 32/36 en Composer (M) |
| `/informes` | Informes (pestañas: actividad, pipeline, conversión, ranking, ticket, cumplimiento, stock, movimientos, kardex) | pestañas + tarjetas + tablas | T scroll | SelectorMes | — | ExportarInforme | exportar | scroll | pestañas sin `role=tab`; bundle 80 kB (M) |
| `/configuracion/{empresa,numeracion,usuarios,listas-precios,listas-precios/:id,marcas,categorias,atributos,auditoria}` | Configuración | shell con subnav + page | RT | Auditoría, listas | Empresa, invitación, DialogoNombre | Dialogo (accesible) | por sección | RT cards | el mejor módulo en consistencia; «1–1 de 1 eventos» (V-prev) |

### Notas por módulo
- **Login**: ver §D. Propuesta: card 400px con logo, h1 24px, subtítulo del producto, botón `lg` 48px siempre activo (validación al enviar, no deshabilitar), link de recuperación como botón ghost de 44px, pie con versión/soporte. Fondo `bg` con un acento sutil de marca (banda o patrón), sin imagen pesada. **Sin tocar el flujo de auth.**
- **Inicio/Dashboard**: la actual es técnica y el dashboard legacy no es reutilizable. Propuesta en §O.12.
- **Ventas / Compras (prioridad alta)**: unificar «cabecera de documento» = `PageHeader` (número + chip + cliente/proveedor + fecha) + barra de acciones (1 primaria según estado + ⋯) + aviso STEL como `Alert` informativo **debajo** del header, no mezclado con acciones. Paneles laterales (stock, pendientes, relacionados) en columna derecha ≥ 1024, en tabs/acordeón en mobile. Líneas: grilla con totales sticky al pie.
- **Catálogo (búsqueda intensiva)**: búsqueda protagonista arriba, facetas en columna izquierda ≥ 1024 y drawer en mobile, chips activos; unificar el naranja; tarjeta de producto con imagen proporción fija (evita saltos).
- **Clientes**: detalle con **tabs** (Resumen · Contactos · Historial · Precios · Memoria) en vez de 8 paneles apilados; datos de contacto clave en el header (teléfono/email clickeables).
- **Mantenimiento**: orden de servicio con **stepper de etapas** (hoy ✓ ○ unicode) visible en header; checks y torque con controles grandes (uso en taller, posiblemente con guantes/tablet).
- **Emails**: conservar densidad tipo cliente de correo (filas de 56–64px, remitente en 600, snippet muted); sólo alinear tokens, íconos (📎 → SVG) y diálogo de descarte.
- **Informes**: legibilidad de datos: `tabular-nums`, números a la derecha, MetricCards arriba, tablas con primera columna sticky, pestañas accesibles; los gráficos (SVG propio) con tokens de color y patrón además de color.
- **Configuración**: es la referencia interna (RT, Dialogo, h1 en denegación). Integrar su subnav al patrón general de sub-navegación (lista lateral ≥ 1024, select/tabs en mobile).

---

## N. Matriz de issues

Severidad: **P0** usabilidad/accesibilidad bloqueante · **P1** consistencia visible o a11y AA · **P2** pulido · **P3** cosmético.
Alcance: **G** global · **L** local. Ev.: V / V-prev / M / E.

| # | Pantalla | Issue | Sev. | G/L | Ev. | Componente candidato | Fix recomendado |
|---|---|---|---|---|---|---|---|
| 1 | Diálogos (Ventas, Compras, Mant., Catálogo) | Sin focus trap / Escape / foco inicial en 7 de 8 | P0 | G | M | `Dialog` | Generalizar `configuracion/Dialogo` |
| 2 | Inicio | Dashboard es placeholder técnico con datos demo | P0 | L | V | `MetricCard`, `ActionCard` | Dashboard nuevo (§O.12) |
| 3 | Todas | Botón primario blanco/naranja 2.94:1 | P1 | G | M | `Button` | `--color-primary #c2410c` |
| 4 | Todas | `--text-muted #999` 2.85:1 | P1 | G | M | tokens | `#737370` |
| 5 | Listados/detalles | Chips success 2.52 y pendiente 2.85 | P1 | G | M | `Badge` | tonos `-soft/-text` |
| 6 | Formularios | Bordes de input 1.26:1 | P1 | G | M+V | `Input` | `--color-border-strong` |
| 7 | Todas | 42 definiciones de botón / 345 `<button>` nativos | P1 | G | M | `Button`, `IconButton` | Migrar por módulo |
| 8 | Todas | 38 definiciones de input/select | P1 | G | M | `Field` + controles | Migrar por módulo |
| 9 | Listados | 6 paginadores + inline en 17 | P1 | G | M | `Pagination` | Unificar con pluralización |
| 10 | Shell | Sidebar plana de 15 ítems sin grupos ni íconos | P1 | G | V | `Sidebar` | §B |
| 11 | 768–1023 | Sidebar 240 deja ~463px de contenido | P1 | G | V-prev | `Sidebar` compacta | 64px con íconos |
| 12 | Todas | 17 media queries arbitrarias | P1 | G | M | tokens/reglas | 4 breakpoints permitidos |
| 13 | Ventas, Emails | `window.confirm` para eliminar/cancelar/descartar | P1 | L | M | `ConfirmDialog` | Reemplazar |
| 14 | Tablas | 3 patrones de tabla/mobile | P1 | G | M | `Table` primitivas + `ResponsiveTable` | Regla §G.5 |
| 15 | Catálogo | Segundo naranja `#d9600a` vía `--accent` indefinido | P1 | L | M | tokens | Usar brand/primary |
| 16 | Login | Botón deshabilitado por opacidad; radios mezclados; link 16px de alto | P1 | L | V | `Button`, `Field` | §M Login |
| 17 | 404 / Login | Links naranja 2.69–2.94:1 | P1 | G | V | `Link` | `--color-primary-text` |
| 18 | Ventas listados | «+ Nueva» visible a roles sin permiso (deuda F12) | P1 | L | V-prev | `PageHeader` actions | Gate por permiso (lógica de UI ya existente en `permisos`; **se corrige en su entrega, no en E0**) |
| 19 | Ventas/Compras detalle | Cabecera de documento cargada (banner + chips + acciones mezcladas) | P1 | L | V-prev | `PageHeader` + `Alert` | §M |
| 20 | Clientes detalle | 8 paneles apilados | P1 | L | V-prev/E | `Tabs` | Tabs |
| 21 | Varias | `--warning-bg`, `--surface-soft`, `--on-primary` no definidos | P2 | G | M | tokens | Definir o reemplazar |
| 22 | Todas | 80 «Cargando…» sin skeleton; carga de ruta en blanco | P2 | G | M+V | `Skeleton`, `Spinner` | §G.12 |
| 23 | Todas | Íconos unicode/emoji mezclados | P2 | G | M | `icons/` | Set SVG propio |
| 24 | Detalles | «← Volver» artesanal ×25, sin breadcrumbs | P2 | G | M | `PageHeader.back` | Unificar |
| 25 | Todas | 11 radios, 5 sombras, z-index literales | P2 | G | M | tokens | Escalas §E |
| 26 | Informes | Pestañas sin `role=tablist`/teclado | P2 | L | M | `Tabs` | Accesible |
| 27 | Grillas/buscadores | Controles 32/36px (confirmar coarse) | P2 | G | M/E | `Button sm` | 44 en coarse |
| 28 | Varias | Labels `.etiqueta` ×25 variantes | P2 | G | M | `Label` | Unificar |
| 29 | Todas | Foco naranja 1.6px bajo 3:1 | P2 | G | V | `--focus-ring` | 2px + halo |
| 30 | Shell sin empresa | «Cargando…» indefinido | P2 | G | V | `EmptyState` | Estado «Sin empresa activa» |
| 31 | 404 | Sin shell y texto «todavía no fue migrada» | P2 | L | V | `EmptyState` | Dentro de AppLayout con texto de producto |
| 32 | Toda la app | Sin toasts para confirmaciones | P2 | G | M | `Toast` | §G.13 (no en E1) |
| 33 | Auditoría | «1–1 de 1 eventos» | P3 | L | V-prev | `Pagination` | Pluralización |
| 34 | Modales | Overlays `rgba` literales distintos | P3 | G | M | `Dialog` | `--overlay` |
| 35 | Branding | Wordmark en mayúsculas, sin logo en UI | P3 | G | V | `Logo` | §Q-5 |
| 36 | Toda la app | Pesos 800/900 y font-size < 12px fuera de impresión | P3 | G | M | tokens | Escala §F |
| 37 | Toda la app | UX de cold start (lazy chunk + Supabase frío) sin feedback | P2 | G | V-prev | `Skeleton` + prefetch | Prefetch de rutas del grupo al hover/idle |

---

## O. Design system — especificación

### O.1 Colores
§E (paleta propuesta). Nombres `--color-*`; los actuales quedan como **alias** durante la migración.

### O.2 Espaciado · O.3 Radius · O.4 Sombras · O.5 Z-index · O.6 Motion
§E (escalas). Regla de revisión: **ningún px/hex nuevo fuera de `tokens.css`** salvo `print`. El script de E0 se reutiliza como chequeo (reporta colores literales y variables no definidas).

### O.7 Tipografía
§F.

### O.8 Botones · O.9 Inputs · O.10 Tablas · O.11 Cards · Diálogos · Badges
§G.3 · §G.8 · §G.4–G.5 · §G.6 · §G.9 · §G.10.

### O.12 Dashboard nuevo (propuesta, **no se programa en E0**)

No es copia del legacy. Datos sólo de lo que ya existe en React (RPC/queries actuales o de Informes); lo que no exista se marca «requiere fuente» y no se inventa.

```
Inicio · Buscatools                                         [Nueva cotización] [⋯]
┌ Actividad comercial (mes) ┐┌ Pedidos pendientes ┐┌ Entregas por hacer ┐┌ Órdenes abiertas ┐
│ $ 12.3M  ▲ 8% vs mes ant. ││ 14 · 3 atrasados   ││ 6 hoy · 2 parciales││ 9 · 2 en espera  │
└───────────────────────────┘└────────────────────┘└────────────────────┘└──────────────────┘
┌ Alertas ───────────────────────────────┐┌ Accesos rápidos ─────────────────────────┐
│ ⚠ 5 productos sin stock con pedidos    ││ Nueva cotización · Nuevo pedido de compra│
│ ⚠ 3 cotizaciones vencen esta semana     ││ Buscar en catálogo · Nueva orden servicio│
│ ✉ 12 emails sin leer de clientes        ││ Informes                                 │
└────────────────────────────────────────┘└──────────────────────────────────────────┘
┌ Últimos documentos (tabla corta, 8 filas, mezcla ventas/compras con chip) ─────────────┐
```

- MetricCards filtradas por rol (salesperson ve comercial; technician ve órdenes; admin todo) usando los permisos existentes.
- Fuentes candidatas: Informes (actividad, pipeline, cumplimiento, stock), listados de Ventas/Compras/Mantenimiento con filtros de estado, Emails (no leídos). Cualquier métrica sin RPC existente queda fuera de la primera versión.
- Mobile: métricas en carrusel de 2 columnas, alertas, accesos rápidos como ActionCards.

### O.13 Layout
§C. Componentes: `AppShell` (header + sidebar + main), `Sidebar` (grupos, acordeón, compacta), `PageHeader`, `PageContainer` (`variant: list | detail | settings` → max-width).

### O.14 Breakpoints
§K.

### O.15 Arquitectura CSS propuesta (sin migrar todavía)

Estado (M): 95 CSS Modules, 1 `global.css` (reset + utilidades + print), 1 `tokens.css`, estilos inline en 15 archivos (Dashboard ×7 y ErrorPage ×7 los principales), 0 CSS-in-JS.

```
src/styles/
  tokens.css          ← escalas + paleta (+ alias viejos durante la migración) + dark
  reset.css           ← (hoy dentro de global)
  global.css          ← base tipográfica, utilidades mínimas (.sr-only, .scroll-x), print
src/components/
  ui/                 ← Button, IconButton, Badge, Spinner, Skeleton, Tooltip
  forms/              ← Field, Label, Input, Select, Textarea, Checkbox, Switch
  modals/             ← Dialog, ConfirmDialog
  tables/             ← Table primitives, ResponsiveTable, Pagination
  cards/              ← Card, MetricCard, ActionCard
  feedback/           ← EmptyState, ErrorState, Alert, (Toast)
  icons/              ← SVG propios
src/layout/  (hoy src/layouts/)
  AppShell, Sidebar, Header, PageHeader, PageContainer, FilterBar
```

Reglas: CSS Modules por componente; los módulos **componen** (no copian) estilos compartidos; nada de utilidades tipo Tailwind; estilos inline sólo para valores dinámicos (anchos de barras de gráficos).

---

## P. Plan de implementación por entregas

Adaptado a la evidencia: primero lo global de mayor impacto con menor riesgo (tokens por alias +
primitivas), después módulo por módulo empezando por el que más se usa y más duplica.

| Entrega | Contenido | Riesgo | Criterio de salida |
|---|---|---|---|
| **E1 · Fundaciones** | **E1-0 baseline visual** con fixture zz (todas las rutas del inventario a 390/768/1024/1440, admin + rol limitado) · tokens nuevos con alias viejos (cambia contraste global sin tocar módulos) · definir las 4 variables faltantes · `Button`/`IconButton`, `Badge`, `Spinner`, `Skeleton`, `Field`+controles, `Dialog`/`ConfirmDialog`, `Pagination`, `EmptyState`/`ErrorState`, set de íconos · chequeo con el script (0 variables no definidas) | Bajo-medio (cambio de color global) | Capturas antes/después sin roturas de layout; contraste AA en la tabla del script; lint/typecheck/test/test:isolated/build verdes |
| **E2 · Shell** | AppShell con sidebar agrupada + compacta en tablet + drawer accesible · Header (empresa, menú usuario, logo) · `PageHeader` · `PageContainer` · 404 dentro del shell · estado «Sin empresa activa» · carga de rutas con skeleton | Medio (toca todas las pantallas por el contenedor) | Mismos permisos de navegación que hoy (test que compare ítems visibles por rol antes/después) |
| **E3 · Ventas + Compras** | Listados (FilterBar, tabla, Pagination, cards mobile), cabecera de documento, grillas de líneas apiladas en mobile, `ConfirmDialog` en lugar de `window.confirm`, diálogos de impresión/entrega · gate visual de «+ Nueva» por permiso existente | Alto (módulos críticos) | Suites de UI de Ventas/Compras verdes; **ninguna** suite antigua sobre Buscatools real; recorrido con fixture |
| **E4 · Catálogo + Clientes** | Búsqueda/facetas, un solo naranja, detalle de cliente en tabs | Medio | Ídem |
| **E5 · Mantenimiento + Emails + Informes + Configuración** | Stepper de etapas, densidad de Emails, legibilidad de Informes (tabs accesibles, tabular-nums, sticky), subnav de Configuración unificada | Medio | Ídem |
| **E6 · Dashboard + Login + cierre** | Dashboard nuevo (§O.12) con fuentes existentes · Login/recuperar/definir contraseña con marca · toasts si se aprueban · limpieza de alias de tokens y CSS muerto · re-medición con el script · doc de cierre | Medio | Script: colores literales en pantalla ≈ 0, media queries = 4, paginadores = 1, diálogos = 1 |

### Reglas de migración incremental
1. **Cero cambios de lógica**: ni queries, ni RPC, ni RLS, ni reglas de negocio, ni permisos. Un cambio de estilo que «necesite» lógica se documenta y se separa.
2. Un módulo por PR/entrega; los componentes nuevos se adoptan **al tocar** cada pantalla, no con reemplazo masivo por regex.
3. Tokens viejos siguen funcionando (alias) hasta E6.
4. Cada entrega: `lint`, `typecheck`, `test`, `test:isolated`, `build`, tamaño de bundle comparado, recorrido mobile 390 y desktop 1440.
5. Los tests que buscan texto/roles (`getByRole('button', {name})`) son la red de seguridad: si un rediseño cambia un nombre accesible, se actualiza el test **y** se justifica.
6. Suites que escriben sobre Buscatools real **no se corren** (siguen pendientes de portar a fixtures).
7. Funcionalidad rota encontrada durante el rediseño: se documenta; se arregla sólo si bloquea la entrega.

### Estrategia de regresión visual
- **Sin herramienta nueva** (no se instala Playwright/Chromatic en E0; decisión §Q-6).
- Por entrega: fixture zz con datos representativos (documentos en cada estado, cliente con todos los paneles, orden con etapas) → capturas en el panel Browser a 390 / 768 / 1024 / 1440 de cada ruta del inventario **antes** y **después**, guardadas fuera del repo (scratchpad), comparadas lado a lado en el reporte.
- Checklist por captura: sin scroll horizontal del body, h1 único, primaria visible, estados vacío/cargando/error forzados, foco visible con Tab, diálogo con Escape.
- Script de E0 re-ejecutado como métrica objetiva de convergencia.

---

## Q. Decisiones que necesito

1. **Sidebar clara u oscura.** Hoy: header oscuro + sidebar blanca. Opciones: (a) mantener así (recomendado: continuidad, el negro ya es parte de la marca Buscatools); (b) todo claro con header blanco (más «SaaS moderno», más neutro); (c) sidebar oscura completa.
2. **Densidad.** Recomendado «comfortable» (filas 44px, controles 40/44) con modo compacto sólo en grillas de líneas. ¿O preferís compacto general (filas 36px) por el volumen de datos?
3. **Naranja fuerte vs sobrio.** Recomendado sobrio: naranja de marca `#f37021` para identidad/foco/activo y naranja oscuro `#c2410c` para botones (cumple AA). La alternativa es mantener `#f37021` en botones con texto oscuro (se ve menos «marca»).
4. **Dashboard inicial.** ¿Qué debe ver cada rol al entrar? Propuesta: métricas por rol + alertas + accesos rápidos (§O.12). ¿O preferís que «Inicio» lleve directo a un módulo (p. ej. Cotizaciones para vendedores)?
5. **Logo / branding.** ¿Hay logo oficial (SVG) y guía de marca? ¿Wordmark «BUSCATOOLS» en mayúsculas, «Buscatools», o «Buscatools ERP»? ¿Tipografía de marca o seguimos con la del sistema (0 kB)?
6. **Baseline visual con fixture en E1-0.** E0 no pudo capturar pantallas con datos sin escribir en la base. ¿Aprobás que E1 arranque creando un fixture zz temporal (empresa + usuarios zz, limpieza al final, sin tocar Buscatools/Torquetools reales ni enviar correos) sólo para capturas antes/después?
7. **Toasts.** ¿Se incorporan en E6 (propuesta mínima sin librería) o se sigue con confirmaciones inline?
8. **Dark mode.** Se mantiene sin expandir (sólo alias sincronizados). ¿Confirmás que queda fuera de la Fase 13?

---

### Anexo — cómo re-medir
```
npm run build
node scripts/fase13-rediseno-auditoria.mjs          # resumen
node scripts/fase13-rediseno-auditoria.mjs --json   # detalle por archivo
```
El script sólo lee `src/` y `dist/`; no usa variables de entorno ni red.
