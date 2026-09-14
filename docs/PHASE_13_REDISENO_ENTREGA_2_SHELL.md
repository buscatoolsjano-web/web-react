# FASE 13 — REDISEÑO GLOBAL · ENTREGA 2 — SHELL GLOBAL

> Sidebar agrupada, barra compacta de tablet, cajón mobile, header oscuro con logo oficial,
> empresa activa visible, menú de usuario, `PageHeader`, 404 dentro del shell y estado
> explícito sin empresa. **Sin cambios de permisos, lógica ni módulos internos**
> (0 archivos de `src/modules/**` tocados).
> Base: `0525de0` (E1 pusheada, CI 34892439763 verde, deploy verificado). Fecha: 2026-09-14.

## A. Cierre de E1 (antes de empezar)

| Paso | Resultado |
|---|---|
| Pre-push | `git status` limpio · 0 secretos/fixtures/temporales en el commit · `/dev/ui` fuera de `dist/` (build de producción limpio, 0 coincidencias) · único cambio fuera de componentes/estilos/docs: la ruta DEV en `routes.tsx` · lint, typecheck, test y test:isolated 71/806 · Dialog y primitivas 6 archivos / 51 tests |
| Push | `e7f6ef0..0525de0` |
| CI | run 34892439763 · success |
| Deploy | `app.buscatools.com` sirve `index-BxydAnhd.js` / `index-hE1Tw_6d.css` (mismos hashes que el build local) con `--color-primary:#c2410c` y `--color-brand-500:#f37021` |
| Revisión en producción (fixture zz) | 21 rutas a 1024px: todas con su h1, 0 alertas de error, 0 scroll horizontal. Contraste igual al local (Pedido detalle 1/140, Clientes 3/203, Informes 2/230…); lo que no pasa AA es deshabilitado/inactivo, salvo lo ya anotado de Catálogo (contador de facetas y glifo `▣`). 6 rutas a 390px sin scroll horizontal. Capturas de detalle de cotización (1024) y órdenes (390) sin regresiones |
| Limpieza | sesión zz del navegador borrada · fixture limpiado · SQL: 0 empresas/usuarios/productos/clientes/equipos zz |

**PHASE 13 · E1 = CLOSED.**

## B. Logo oficial

- Asset: `public/brand/buscatools-logo.png` (1400×673, 36 kB, PNG con transparencia).
- Procedencia verificada: es **byte a byte** (MD5 `94414b6e…`) el archivo que publica el sitio oficial en `buscatool.com/wp-content/uploads/2024/06/Logo-Busca-Tools-full-png-1400x673.png`. Se copió la copia local idéntica, **sin editar ni redimensionar**.
- **No** se usaron las vectorizaciones automáticas.
- En el header oscuro «tools» (gris oscuro) no se leería: el PNG se apoya en una **placa clara** (`.logoFondo`), sin alterar el archivo. Al llegar el SVG oficial se reemplaza sólo el asset (misma ruta o `src` del `<img>`).
- Accesibilidad: el enlace de marca se llama «Buscatools ERP, ir al inicio»; el `<img>` es decorativo (`alt=""`) y «ERP» es texto al lado.

## C. Navegación agrupada (`src/layouts/navegacion.ts`)

```
Inicio
OPERACIÓN      Ventas ▾ (Cotizaciones · Pedidos · Notas de entrega)
               Compras ▾ (Proveedores · Pedidos · Notas de entrada · Facturas)
               Mantenimiento ▾ (Equipos · Órdenes de servicio)
DATOS          Catálogo · Clientes
COMUNICACIÓN   Emails · WhatsApp (Pronto, sin enlace)
ANÁLISIS       Informes
ADMINISTRACIÓN Configuración
```

- **Mismos destinos y mismos roles que la lista plana de Fase 1.** `navegacion.test.ts`
  guarda la lista vieja literal y compara destino por destino para `admin`, `employee`,
  `salesperson`, `technician`, `customer`, `distributor` y rol vacío.
- Los módulos sin subsecciones visibles para el rol y los grupos vacíos desaparecen (un vendedor ve Inicio, Ventas, Catálogo, Clientes y WhatsApp).
- «Puntos de revisión» de Mantenimiento **no** se agregó al menú (hoy no está; agregarlo cambiaría la navegación ofrecida).
- Sólo cambian etiquetas dentro de su módulo: «Dashboard» → «Inicio», «Pedidos de compra» → «Pedidos» (bajo Compras), «Facturas de proveedor» → «Facturas». Los títulos de las páginas no cambian.

## D. Shell (`src/layouts/`)

| Rango | Comportamiento | Verificado en navegador |
|---|---|---|
| **≥ 1024** | Sidebar clara 240px, grupos con título, módulos desplegables (`button` + `aria-expanded`/`aria-controls`), el de la ruta activa se abre solo; activo = fondo suave + **barra de marca** a la izquierda (no sólo color) | 1280px: Ventas desplegado en `/ventas/pedidos`, Compras en `/compras/facturas`, 0 fallas AA en 30 textos de header+sidebar |
| **768–1023** | Barra compacta 64px: íconos de 44×44 con nombre accesible (`sr-only`) y `title`; las hojas navegan, los módulos abren el panel completo con ese módulo desplegado; botón «Expandir menú» | 900px: 10 controles 44×44, «Ventas» `aria-current`, contenido **821px** (antes 645px) · a 768 serán 704px (antes ~463–528) |
| **< 768** | Hamburguesa → cajón 240px (`role="dialog"`, `aria-modal`, «Menú principal») | 390px: header sin desborde (hamburguesa · logo · empresa · avatar), 404 sin scroll horizontal |

Cajón (tablet y mobile), probado con teclas reales: foco inicial en «Cerrar menú», Tab →
«Inicio», header + barra + `main` **inert**, scroll del body bloqueado, **Escape** cierra y
el foco vuelve al disparador («Abrir menú» o el ícono «Compras»), se cierra al navegar y al
cruzar de breakpoint.

Header oscuro:
- Marca (logo + «ERP») → `/`.
- **Empresa activa siempre visible**: con una membresía, texto con ícono, nombre y rol en castellano («Administrador»); con varias, `select` etiquetado «Empresa activa» con «Torquetools · Vendedor». En mobile se trunca el nombre y se oculta el rol.
- **Menú de usuario** (patrón *disclosure*): avatar con iniciales, panel con nombre, email, «empresa · rol» y «Cerrar sesión»; foco al abrir en «Cerrar sesión», Escape/click afuera/Tab afuera cierran y el foco vuelve al botón (verificado con Escape real).
- Reemplaza al email crudo y al botón «Salir» del header.

## E. Estados del shell

| Caso | Antes | Ahora |
|---|---|---|
| Membresías cargando | cada módulo mostraba su «Cargando…» | `role="status"` «Cargando tu empresa…» |
| Usuario **sin empresa activa** | «Cargando…» infinito (visto en E0) | h1 «Tu usuario no tiene una empresa activa» + explicación + **Reintentar** + **Cerrar sesión** (verificado con usuario zz sin membresía) |
| Error al leer membresías | cada módulo | `ErrorState` «No pudimos leer tus empresas.» + Reintentar; **sin** detalle técnico (test: no aparece `JWT`/`42501`) |
| Ruta inexistente | 404 **fuera** del shell, «todavía no fue migrada», link 2.69:1 | 404 **dentro** del shell: h1 «No encontramos esta pantalla», «Ir al inicio», header y menú a mano |
| Carga de chunk de ruta | `<p style>Cargando…</p>` | `CargandoRuta` (spinner + `role="status"`) |

Cambios de soporte (no de lógica):
- `EmpresaContext` agrega `reintentar()` (el `refetch` de la misma query de membresías). La selección de empresa, la validación de la preferencia y el `removeQueries` no cambian.
- La ruta `*` pasa a ser hija del layout y **privada**: sin sesión, primero el login y después el 404 (antes el 404 se veía sin sesión). Ninguna otra ruta cambió.

## F. `PageHeader` (`src/components/layout/PageHeader.tsx`)

`title` (único h1) · `status` junto al título · `subtitle` · `back {to,label}` **o**
`breadcrumbs` (nav «Ruta», último `aria-current="page"`) · `actions` (en mobile bajan a
ancho completo). **No se aplicó a ningún módulo** (regla de E2); queda listo para E3.

## G. Tokens e íconos

- `--color-topnav-border` (borde del select de empresa sobre el header oscuro).
- Ícono nuevo `sliders` para Configuración (el `settings` de E1 se leía como un sol a 20px).

## H. Verificación

| Chequeo | Resultado |
|---|---|
| `npm run lint` | OK |
| `npm run typecheck` | OK |
| `npm test` | **74 archivos / 833 tests** (+3 archivos, +27 tests) |
| `npm run test:isolated` | **74 / 833** |
| `npm run build` | OK · `/dev/ui` fuera de `dist/` · `dist/brand/buscatools-logo.png` presente |
| Bundle | `index` JS 108 → **128 kB** (gzip 31.8 → 38.5 kB): el shell ahora carga íconos, IconButton, Spinner y Empty/ErrorState en el chunk inicial · CSS `index` 9.8 → 20.9 kB · 128 chunks JS |
| Auditoría | variables no definidas 0 · colores literales 103 |

Tests nuevos: `navegacion.test.ts` (11: paridad por rol, orden de grupos, vendedor, WhatsApp,
ruta activa), `AppLayout.test.tsx` (13: logo, empresa única y múltiple, menú de usuario,
sidebar agrupada y desplegable, filtro por rol, barra compacta + panel, cajón con foco/inert/
Escape, cerrar al navegar, cargando, sin empresa, error sin detalle técnico, iniciales),
`PageHeader.test.tsx` (3, incluye 404).

Bugs encontrados en el navegador y corregidos antes del commit:
1. Módulos colapsados mostraban sus hijos: `display:grid` le ganaba al atributo `hidden` → `.hijos[hidden]{display:none}`.
2. Scroll horizontal en la sidebar (la fila «WhatsApp · Próximamente» ensanchaba la grilla) → `minmax(0,1fr)` + texto con elipsis + etiqueta «Pronto».

## I. Fixture

`scripts/fase13-rediseno-ui-fixture.mjs` suma un usuario zz **sin membresía** (link
`sinEmpresa`) para ver el estado vacío. Limpieza al terminar: 1 empresa y 2 usuarios zz
borrados; SQL: 0 empresas, 0 usuarios, 0 productos, 0 clientes, 0 equipos zz. Sesión zz
borrada del navegador.

## J. Deudas y siguientes pasos

1. Las páginas siguen con sus encabezados propios; adoptan `PageHeader` al migrar cada módulo (E3–E5).
2. «Inicio» sigue mostrando el placeholder de Fase 1 (dashboard por rol en E6).
3. Login / recuperar / definir contraseña siguen con la marca en texto (E6).
4. El chunk inicial creció 20 kB (6.7 kB gzip); si molesta, `iconPaths` puede separarse por uso.
5. Pendientes de E1 sin cambios: barra sticky sobre líneas en detalle de pedido (E3), `window.confirm` (E3/E5), «+ Nueva» por rol (E3), Catálogo AA (E4), «1 eventos» (E5).
6. Cuando exista el SVG oficial del logo: reemplazar `public/brand/buscatools-logo.png` y, si su versión clara lo permite, quitar la placa `.logoFondo`.
