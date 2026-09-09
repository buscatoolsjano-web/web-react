# Riesgo de origen compartido entre el legacy y React

**Prioridad: ALTA** · Detectado: 2026-09-09, durante las pruebas de Fase 3
· Estado: **abierto, sin mitigar**

---

## 1. El problema

Las dos aplicaciones viven bajo el mismo origen:

| | URL |
|---|---|
| Legacy | `https://buscatoolsjano-web.github.io/Buscatools/` |
| React | `https://buscatoolsjano-web.github.io/web-react/` |

El navegador define el origen como **esquema + host + puerto**. La ruta
**no** forma parte. Para el navegador, `/Buscatools/` y `/web-react/` son
la misma aplicación, y por lo tanto comparten:

- `localStorage` y `sessionStorage`
- `IndexedDB`
- cookies sin `Path` restringido
- permisos del sitio

Verificado en vivo: desde la consola de la app React se leen las **53
claves del legacy**, y desde el legacy se lee `bt-auth`.

## 2. Por qué importa, y en qué dirección

La dirección peligrosa **no** es la que parece a primera vista.

Que React pueda leer datos del legacy es irrelevante: React no los lee
(verificado en la sección 5) y son datos que el usuario ya tiene.

**Lo grave es al revés: el legacy puede leer `bt-auth`, el token de sesión
de Supabase de la aplicación nueva.**

```js
// Desde cualquier código que corra en el legacy:
JSON.parse(localStorage.getItem('bt-auth')).access_token
```

Con ese token se puede hacer cualquier request a la API con la identidad
del usuario, hasta que expire. RLS sigue funcionando —el atacante queda
limitado a lo que ese usuario puede ver— pero eso ya es todo lo que ese
usuario puede ver.

**Superficie de ataque:** `app.js` del legacy tiene 45.345 líneas, genera
HTML por concatenación de strings y usa `innerHTML` de forma extensiva. Un
único XSS ahí —por ejemplo un nombre de producto o un campo de cliente con
markup— alcanza para robar la sesión del sistema nuevo.

No hace falta que el usuario abra el legacy en ese momento: alcanza con
que lo abra alguna vez en el mismo navegador.

## 3. La solución: separar el origen

> **Requisito bloqueante antes de abrir el sistema a distribuidores,
> clientes o cualquier usuario externo.**

Mover la aplicación React a su propio origen:

```
https://app.buscatools.com
```

Con eso la separación la hace cumplir el navegador, no una convención:
`buscatoolsjano-web.github.io` deja de poder leer el `localStorage` de
`app.buscatools.com`, y viceversa. **La política del mismo origen es una
garantía del navegador, no una configuración que se pueda olvidar.**

`buscatoolsjano-web.github.io/web-react/` es una URL de desarrollo. **No
es la arquitectura final.**

### Qué implica el cambio

| Aspecto | Hoy | Después |
|---|---|---|
| Hosting | GitHub Pages | El que sea (Cloudflare Pages, Vercel, S3…) |
| Router | HashRouter (ADR-001) | `createBrowserRouter` — URLs sin `#` |
| `base` de Vite | `/web-react/` | `/` |
| Sesión | compartida con el legacy | **aislada por el navegador** |

El cambio de router está previsto desde la Fase 1: `createHashRouter` está
aislado en `src/app/router.tsx` justamente para esto, y ADR-001 lo
documenta. Es cambiar una línea.

### No se hace ahora

Cambiar el hosting en medio de la Fase 3 interrumpiría las pruebas en
curso. Queda como requisito previo a la apertura a usuarios externos, no
como tarea de esta fase.

## 4. Auditoría de claves del legacy — sólo nombres

**Metodología:** se leyeron únicamente los **nombres** y los **tamaños en
bytes** de las claves. **No se leyó, registró ni transmitió ningún valor.**
El uso se determinó contando referencias en el `app.js` del clon de sólo
lectura del legacy. **No se modificó ni se borró ninguna clave.**

Total: **54 claves**, ~1,2 MB. De ellas, 53 son del legacy y 1 es de React
(`bt-empresa-activa`).

### Sensibilidad ALTA

| Clave | Tipo estimado | ¿Sigue usada? | Acción recomendada |
|---|---|:---:|---|
| `erp_auth_users` | Usuarios y credenciales del login propio del legacy | **Sí** (11 refs) | Ya está reemplazado por Supabase Auth en el sistema nuevo. Al retirar el legacy, borrar. Mientras tanto, asumir que cualquiera con acceso al navegador la lee |
| `erp_wappfly_token` | Token de API de WhatsApp | **NO — 0 refs** | **Credencial huérfana: el legacy ya no la usa pero sigue guardada.** Revocar el token del lado del proveedor y borrar la clave. Es la acción más urgente y la más barata |
| `erp_ai_config` | Configuración de IA (posible API key) | Sí (3 refs) | Verificar si contiene una clave privada. Si la contiene, revocarla: una API key de IA en el navegador es pública. Debe ir a una Edge Function |
| `erp_session_user`, `erp_session_empresa`, `erp_session_ts` | Sesión simulada del legacy | Sí (5/2/4 refs) | Es la sesión editable desde consola que el sistema nuevo elimina. Sin acción sobre el legacy |
| `erp_client_accounts` | Cuentas del portal de clientes | Sí (4 refs) | Migran a `customers` + `company_memberships` |
| `erp_contactos`, `erp_client_leads`, `buscatools_clientes_extra*` | Datos de contacto de clientes (datos personales) | Sí (3/3 refs) | Migran a `customers`. Mientras estén acá, viajan en el navegador de cualquiera que abra el legacy |

### Sensibilidad MEDIA

| Clave | Tipo estimado | ¿Sigue usada? | Acción recomendada |
|---|---|:---:|---|
| `erp_user_perms` | Matriz de permisos por usuario | Sí (3 refs) | Es control de acceso del lado del cliente: editable desde consola. Reemplazado por RLS |
| `erp_emails_access` | Permisos de acceso a correos | Sí (3 refs) | Idem |
| `bterp_price_memory` | Memoria de precios y costos | Sí (2 refs) | Expone margen comercial. Reemplazado por `product_prices` con RLS |
| `erp_cotizaciones` (345 kB), `erp_notas_entrega` (216 kB), `erp_pedidos` (209 kB), `erp_pedidos_compra`, `erp_facturas`, `erp_cotizacion_borrador` | Documentos comerciales con datos de clientes | Sí (7 refs) | Migran en Fase 4 (Ventas) y 5 (Compras) |
| `erp_trazabilidad_log` (199 kB), `erp_traz_ADMIN` (174 kB), `erp_traz_JANO`, `erp_traz_JUAN`, `erp_traz_BRIAN`, `erp_activity_log` | Registros de actividad por usuario | Sí (7 refs) | Auditoría del lado del cliente: no confiable. Reemplazar por auditoría en base |
| `erp_kardex`, `erp_stock_deltas` | Movimientos y ajustes de stock | Sí (2 refs) | Reemplazados por `stock_movements` |
| `spd_client_memory_v1`, `erp_clone_prompts`, `erp_chat_ai_responses`, `erp_chat_messages`, `erp_mensajes`, `erp_bandeja_mensajes` | Conversaciones y prompts | Sí (5/5 refs) | Revisar si contienen datos de clientes antes de descartar |
| `erp_client_solicitudes`, `erp_client_carrito` | Actividad del portal de clientes | Sí | Migran con Ventas |

### Sensibilidad BAJA

| Claves | Tipo | Acción |
|---|---|---|
| `erp_prefs_*`, `erp_dash_widget_cfg_*`, `erp_ln_collapsed`, `erp_inicio_panel_period_*`, `erp_dashboard_inicio_ADMIN` | Preferencias de interfaz | Ninguna |
| `mant_activos`, `mant_historico`, `mant_fichas`, `mant_marcas` | Datos de mantenimiento | Migran en Fase 6 |
| `erp_finanzas_rates`, `erp_emails_spam`, `_supaClienteSyncDone` | Cotizaciones, flags | Ninguna |
| `firebase:host:buscatoolserp-default-rtdb.firebaseio.com` | Endpoint de Firebase RTDB | Revela infraestructura. Verificar que esa base no esté abierta |

### Lo primero que haría

1. **Revocar `erp_wappfly_token`.** Es una credencial que ya no se usa,
   sigue guardada, y revocarla no rompe nada porque el código no la lee.
2. **Revisar `erp_ai_config`.** Si tiene una API key, ya es pública.
3. Lo demás se resuelve solo al retirar el legacy.

**Ninguna de estas acciones se hace desde React.** React no escribe ni
borra claves del legacy, por decisión explícita (sección 5).

## 5. Verificación: React no depende de ninguna clave del legacy

Búsqueda sobre todo `src/`:

```
grep -rniE "erp_|mant_|bterp_|spd_client|buscatools_clientes_extra|firebase:host|_supaCliente" src/
→ ninguna coincidencia
```

Las **únicas** claves que la aplicación React toca:

| Clave | Dónde | Para qué |
|---|---|---|
| `bt-auth` | SDK de Supabase | Token de sesión. Lo maneja el SDK, nunca a mano |
| `bt-empresa-activa` | `features/empresa/preferencia.ts` | Empresa elegida. Comodidad de interfaz, validada contra las membresías reales |
| `bt-chunk-recargado` | `app/routes.tsx` (sessionStorage) | Marca de reintento tras un deploy |

Ninguna otra lectura ni escritura de storage existe en el proyecto.

## 6. Verificación: qué limpia el cierre de sesión

| Qué | Cómo | Verificado |
|---|---|---|
| `bt-auth` | `supabase.auth.signOut()` | ✅ la clave desaparece |
| `bt-empresa-activa` | `olvidarEmpresaPreferida()` | ✅ en el botón Salir **y** en el evento `SIGNED_OUT`, que cubre el cierre desde otra pestaña y el token vencido |
| Caché de TanStack Query | `queryClient.clear()` | ✅ los selectores quedan vacíos: sin listas de precios ni membresías |
| Estado de React | Desmontaje por la redirección a `/auth/login` | ✅ 0 filas en la tabla |

Medido tras cerrar sesión con Jano: `email: null`, `filas: 0`,
`opciones: ""`, redirección a `#/auth/login?next=%2Fcatalogo`.

**Lo que NO limpia, a propósito:** ninguna clave del legacy. Borrar datos
de la otra aplicación desde esta sería destruir información ajena sin que
nadie lo pida.

## 7. Resumen

| | |
|---|---|
| **Riesgo** | El legacy puede leer el token de sesión de React |
| **Causa** | Mismo origen: la ruta no separa aplicaciones |
| **Impacto** | Un XSS en el legacy toma la sesión del sistema nuevo |
| **Mitigación** | Mover React a `app.buscatools.com` |
| **Bloquea** | Apertura a distribuidores, clientes y usuarios externos |
| **Costo** | Un cambio de hosting + `createBrowserRouter` (previsto en ADR-001) |
| **Acción inmediata y barata** | Revocar `erp_wappfly_token` |
