# Fase 12 · Configuración — Entrega 4: visor de auditoría y cierre del módulo

Fecha: 2026-09-14 · Proyecto `uaxcfufvapzulqvynanp` · Migraciones
`fase12_config_e4_auditoria` y `fase12_config_e4_auditoria_rendimiento` (estado
final en [`docs/database/PHASE_12_CONFIGURACION_ENTREGA_4.sql`](database/PHASE_12_CONFIGURACION_ENTREGA_4.sql)).

---

## A. Resumen

Configuración queda cerrada con ocho secciones: **Usuarios**, **Empresa** (con
logo), **Numeración** (sólo lectura, con autoridad STEL/ERP), **Listas de
precios** (sólo lectura), **Marcas**, **Categorías**, **Atributos** (sólo
lectura) y la nueva **Auditoría** (sólo admin, sólo lectura).

Esta entrega agrega el visor de auditoría (2 RPC, 0 tablas, 0 índices), revalida
Auth sin enviar correos, barre seguridad, recorre las ocho pantallas como admin y
como employee en 390 · 430 · 768 · 1440, corrige 3 detalles de UI y cierra la
cobertura de las 65 funcionalidades de la Entrega 0.

Decisiones que siguen abiertas y **no se resuelven acá**:

- `PRODUCT_MASTER = STEL / LEGACY` por ahora.
- `PRICE_MASTER = UNDECIDED` (U-B-2).
- `PRICE_LISTS = READ_ONLY`.
- Numeración: Buscatools `quote` / `sales_order` / `delivery` = **STEL**; Torquetools **sin filas** de autoridad. Sin cambios.

## B. Auditoría

### B.1 Fuentes (medido)

| Clase | Tabla | Filas reales | Qué registra | ¿En el visor? |
|---|---|---:|---|---|
| **A · Configuración** | `users_audit` | 0 | invitación, alta a cuenta existente, reenvío, cambio de rol, suspensión, reactivación | **sí** |
| A | `company_audit` | 0 | datos de empresa (sólo nombres de campos), logo subido/quitado | **sí** |
| A | `catalog_audit` | 0 | marcas y categorías | **sí** |
| A | `document_numbering_authority_audit` | 3 | alta/cambio/baja de autoridad STEL/ERP (las 3 del alta de E2.5, sin actor) | **sí** |
| B · Operativa | `sales_audit`, `purchases_audit`, `maintenance_audit`, `email_events` | 0 · 0 · 0 · 2 | documentos, stock, emails | no (tienen su RLS y su módulo) |
| C · Técnica | `email_sync_log`, `whatsapp_webhook_events`, `auth.audit_log_entries` | 107 · 0 · — | sincronización, webhooks, eventos de Auth (con IP y emails) | no |
| D · Legacy | — | — | los logs del legacy no están en esta base | no |

No existe `audit_logs` en `public`. Nada de la clase B/C se mezcló en el visor.

### B.2 Modelo de evento (lo que existe, sin inventar)

| Campo del visor | users_audit | company_audit | catalog_audit | numeración |
|---|---|---|---|---|
| evento | `action` | `action` | `action` | `NUMBERING_AUTHORITY_` + `operation` |
| actor | `actor_id` | `actor_id` | `actor_id` | `changed_by` (nulo en SQL/service role) |
| entidad | `target_user_id` → nombre actual | la empresa | `entity_id` → nombre actual, o `entity_name` (snapshot) si ya no existe | `doc_type` |
| fecha | `created_at` | `created_at` | `created_at` | `changed_at` |
| detalle | rol y estado antes/después, email del afectado | nombres de campos | campos, nombre registrado | autoridad antes/después, motivo, origen técnico |

Actor nulo → «Sin actor registrado» o «Proceso del sistema (sin usuario)» si hay
origen técnico. **Nunca** se atribuye a una persona.

### B.3 RPC

- `config_auditoria_listar(company, desde, hasta, módulo, evento, actor, texto, límite, desplazamiento)`: une las 4 fuentes, filtra y pagina **en la base**; orden `fecha desc, id desc, origen` (estable); devuelve `total`.
- `config_auditoria_actores(company)`: actores con eventos (para el filtro).
- **SECURITY DEFINER, justificado:** la bitácora de numeración está cerrada a `authenticated` y nombre/email salen de `auth.users`. Guardas: `app.is_admin` (membresía admin **activa**) sobre el `p_company` pedido; `search_path` fijo; EXECUTE sólo `authenticated`; validación estricta de parámetros (`datos_invalidos`).
- **Detalle con lista blanca** armado en SQL (nunca el JSON crudo) y vuelto a filtrar en el frontend. **Email** sólo de personas que son o fueron miembros de esa empresa; de las demás, sólo nombre.
- **Append-only:** no hay ninguna función de borrado/edición; `authenticated` sólo tiene SELECT en 3 bitácoras (RLS admin) y nada en la de numeración.

### B.4 Filtros

Fecha desde/hasta (días en hora de Argentina), módulo, evento (según módulo),
actor, texto libre (nombre/email del actor y del afectado, nombre de marca o
categoría, motivo, código de evento; `%` y `_` literales). Todos server-side.
Paginación de 50.

### B.5 Retención

Tamaños actuales: 64–80 kB por tabla (casi todo estructura). Crecimiento esperado
bajo (acciones administrativas). **No se implementa purga** y no se propone una
política: no hay evidencia de volumen que la justifique.

## C. Pantallas

| Sección | Admin | Employee | Otros roles internos / externos |
|---|---|---|---|
| Usuarios | administra | aviso «Sólo un administrador…» (sin menú) | sin acceso a Configuración |
| Empresa | edita + logo | lee | ídem |
| Numeración | lee (autoridad STEL/ERP) | lee | ídem |
| Listas de precios (+ detalle) | lee | lee | ídem |
| Marcas | crea / desactiva / elimina sin uso | lee | ídem |
| Categorías | crea / renombra / elimina sin uso | lee | ídem |
| Atributos | lee | lee | ídem |
| **Auditoría** | **lee** | aviso (sin menú) | ídem |

Revisión integral (fixture `scripts/fase12-configuracion-entrega4-ui-fixture.mjs`,
magic links de un solo uso, limpiado): navegación, títulos, estados de sólo
lectura, vacíos, 404 de Configuración inexistente, textos (sin `undefined`,
`NaN`, `null` ni inglés), «Cargando…» que termina.

## D. Permisos

Probado con JWT reales (suite E4 §1 y suites E1–E3):

| Acción | admin | employee | salesperson | technician | customer | distributor | anon | admin otra empresa |
|---|---|---|---|---|---|---|---|---|
| ver auditoría / actores | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| admin **suspendido** ve auditoría | ❌ | | | | | | | |
| escribir/borrar bitácoras por REST | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

## E. Escrituras permitidas por Configuración (inventario completo)

| Operación | Quién | Por dónde | Auditoría |
|---|---|---|---|
| Cambiar rol | admin | `config_cambiar_rol` | `MEMBERSHIP_ROLE_CHANGED` (trigger) |
| Suspender / reactivar | admin | `config_cambiar_estado` | `MEMBERSHIP_SUSPENDED` / `_REACTIVATED` (trigger) |
| Invitar / agregar cuenta existente / reenviar | admin | Edge `config-usuarios` → `config_registrar_miembro`, `config_auditar_reenvio` | `USER_INVITED` / `MEMBERSHIP_ADDED` / `INVITATION_RESENT` |
| Editar datos de empresa | admin | `config_empresa_actualizar` | `COMPANY_UPDATED` (sólo nombres de campos) |
| Subir / quitar logo | admin | Edge `config-empresa-logo` → `config_empresa_logo_registrar` | `COMPANY_LOGO_UPDATED` / `_REMOVED` |
| Crear / desactivar / reactivar / eliminar marca | admin | `config_marca_*` | `BRAND_*` |
| Crear / renombrar / eliminar categoría | admin | `config_categoria_*` | `CATEGORY_*` |
| (Plataforma) cambiar autoridad de numeración | migración / SQL | trigger | `NUMBERING_AUTHORITY_*` |

**Cobertura de auditoría verificada** (suite E4 §2): cada una de estas
escrituras dejó su evento con actor, el total del visor coincide con la suma de
las 4 bitácoras, y 12 lecturas no escribieron nada.

## F. Sólo lectura / prohibido

| Qué | Estado | Garantía |
|---|---|---|
| Secuencias (`document_sequences`) | no se editan | sin políticas ni grants; sólo `next_document_number` |
| Autoridad de numeración | no se edita desde la app | sin grants; cambio por migración auditado |
| Emisión de COTI/PDV/RT en Buscatools | bloqueada mientras STEL sea autoridad | guardrail E2.5 (base) |
| Listas de precios y precios | sólo lectura | grants revocados, sin RPC de escritura (E3) |
| Atributos | sólo lectura | grants revocados (E3) |
| Productos | fuera de Configuración | deuda: `products_write` sigue abierto por REST (§N) |
| Empresa y membresías por REST | cerrado | políticas eliminadas (E1/E2) |
| Bitácoras | append-only | sólo SELECT (RLS admin) o nada |

## G. Seguridad

**Barrido (medido):**

- SECURITY DEFINER sin `search_path` en `public`/`app`: **0**.
- SECURITY DEFINER ejecutable por `anon`: **0**. Todas las `config_*`: EXECUTE sólo `authenticated` (+ service_role/postgres).
- Tablas sin RLS en `public`: **0**. Buckets: 3, todos privados; `empresa-logos` 2 MB, PNG/JPEG/WEBP.
- Frontend: 0 referencias a service role o secretos; el bundle sólo trae `VITE_SUPABASE_URL`, la clave publicable y `VITE_EMAILS_API_URL` (la cadena `sb_secret_` que aparece es la verificación de prefijos de supabase-js).
- Auditoría: ningún token, contraseña, enlace de invitación/recuperación ni header en detalles (suite E4 §3); los valores de los datos de empresa no se registran.
- Preexistente (fuera de Phase 12, §N): `anon` conserva grants de tabla en ~37 tablas de Ventas/Compras/Mantenimiento (RLS lo bloquea: no hay políticas para anon); funciones DEFINER del esquema `app` con EXECUTE a PUBLIC (esquema no expuesto por la API; helpers y triggers).

**Auth (revalidado sin enviar correos):**

| Punto | Resultado |
|---|---|
| Signup público | **deshabilitado** (`signup_disabled`) |
| Largo mínimo de contraseña | **8** (7 → `weak_password`, 8 → aceptada) |
| Site URL / Redirects | enlace pedido a `app.buscatools.com` → termina en `app.buscatools.com`; destino ajeno → cae a `app.buscatools.com` |
| Proveedores | sólo email |
| SMTP | configurado; última entrega real registrada: 2026-09-14 14:51–14:52 UTC (incidente E1). En E4 **no se envió ningún correo** (logs de Auth: 0 `user_invited` posteriores; los `recovery_requested` son `generateLink` de fixtures, que no envía) |
| SPF / DKIM / DMARC | **pendientes** (DNS, no se tocó) — deuda, no blocker funcional |

**Advisors:** 0 ERROR nuevos. ERROR preexistente: vista `product_availability`
(SECURITY DEFINER). WARN «DEFINER ejecutable por authenticated»: 43 (41 → 43 por
las 2 RPC de auditoría, con guarda de admin). WARN preexistente: protección de
contraseñas filtradas deshabilitada. INFO preexistente: 7 tablas con RLS y sin
políticas (cerradas a propósito).

## H. Multiempresa

- El visor valida `app.is_admin(p_company)`: pedir otra empresa → `sin_permiso`; empresa nula → `sin_permiso`.
- Nunca aparecen eventos de otra empresa (suite E4 §4).
- Actor o persona afectada que no es miembro de la empresa: se muestra el nombre, **no** el email.
- Admin de dos empresas ve la auditoría de la empresa activa del selector.

## I. Performance

Volumen real: 3 eventos. Para medir se armó un fixture temporal con **12.000
eventos** (limpiado). Tiempos desde este equipo, con ~190 ms de red por RPC:

| Consulta | Primera versión | Versión final | Servidor (≈ final − red) |
|---|---:|---:|---:|
| abrir (página 1) | 285 ms | 305 ms | ~115 ms |
| página 100 | **740 ms** | 325 ms | ~135 ms |
| módulo | 245 ms | 285 ms | ~95 ms |
| evento | 210 ms | 205 ms | ~15 ms |
| actor | 260 ms | 290 ms | ~100 ms |
| rango de fechas | 255 ms | 260 ms | ~70 ms |
| texto | **1.740 ms** | 415 ms | ~225 ms |
| actores | 195 ms | 195 ms | ~5 ms |

La primera versión resolvía nombre y email **por evento** antes de paginar; la
final resuelve cada persona **una vez** con joins y arma el JSON sólo para la
página. **No se agregó ningún índice**: las 3 bitácoras grandes ya tienen
`(company_id, created_at desc)` y la de numeración tiene 3 filas.

## J. Mobile y accesibilidad

Admin (9 pantallas, incluida el detalle de lista) en **390 · 430 · 768 · 1440**:
sin desborde global, todos los botones/inputs/selects ≥ 44 px, inputs y selects
a 16 px, sin textos rotos. Employee en 390: menú sin Usuarios ni Auditoría, URLs
directas con aviso y título, 0 botones de escritura. Auditoría: tabla en
escritorio (entra sin scroll interno en 1440), cards en mobile, en 768 con el
menú lateral la tabla scrollea dentro de su contenedor (igual que el resto de las
tablas). Filtros con `label`, detalle expandible con `aria-expanded` /
`aria-controls`, error de fechas con `aria-invalid` / `aria-describedby`,
paginador con `aria-live`, estados con texto.

## K. Regresión

| Suite / comando | Resultado |
|---|---|
| Config E1 (sin `--con-envios`) | 85/85 |
| Config E2 | 71/71 |
| Config E2.5 | 46/46 |
| Config E3 | 70/70 |
| **Config E4** (`scripts/fase12-configuracion-entrega4-tests.mjs`) | **39/39** |
| `regresion-rls-roles.mjs` | 71 PASS · 0 fallos |
| `npm run lint` · `typecheck` · `build` | verdes |
| `npm test` · `npm run test:isolated` | 66 archivos · 765 tests cada uno |

Frontend nuevo: `lib/auditoria.test.ts` (13) y `pages/AuditoriaPage.test.tsx` (8).

**No se corrieron**, por seguir escribiendo sobre Buscatools real sin portar a
fixtures: `stage1-ventas-*`, `stage3-*`, `fase6-cierre-tests`,
`fase7-mantenimiento-entrega5-tests` (deuda §N).

## L. Objetos de base de Phase 12

Contados contra la base (10 migraciones `fase12_*`):

| Tipo | # | Detalle |
|---|---:|---|
| Tablas | **5** | `users_audit`, `company_audit`, `catalog_audit`, `document_numbering_authority`, `document_numbering_authority_audit` |
| Funciones nuevas | **41** | 26 `public.config_*` (E1: 7 · E2: 5 · E3: 12 · E4: 2) + `public.autoridad_numeracion_empresa` + 14 `app.*` (`auditar_membresia`, `es_admin_activo`, `proteger_ultimo_admin`, `config_texto`, `auditar_autoridad_numeracion`, `es_importacion_externa`, `exigir_emision_erp`, `guardar_autoridad_numeracion`, `catalogo_exigir_admin`, `catalogo_exigir_campos`, `catalogo_exigir_lector`, `catalogo_nombre`, `catalogo_slug`, `auditoria_persona`) |
| Funciones modificadas | **2** | `next_document_number`, `confirmar_entrega` (guardrail STEL) |
| Triggers | **7** | `trg_memberships_auditar`, `trg_memberships_ultimo_admin`, `trg_00_autoridad_numeracion` ×3, `trg_autoridad_numeracion_audit_ins_del`, `trg_autoridad_numeracion_audit_upd` |
| Políticas creadas | **4** | `users_audit_select`, `company_audit_select`, `catalog_audit_select`, `storage.objects.empresa_logos_select` |
| Políticas eliminadas | **8** | `memberships_write`, `companies_update`, `brands_write`, `categories_write`, `attrdefs_write`, `pac_write`, `pricelists_write`, `prices_write` |
| Índices | **3** | `idx_users_audit_empresa`, `idx_company_audit_empresa`, `idx_catalog_audit_company` |
| Buckets | **1** | `empresa-logos` (privado) |
| Edge Functions | **2** | `config-usuarios`, `config-empresa-logo` |

## M. Bugs

Encontrados y corregidos en esta entrega:

1. **Visor lento con volumen** (resolución por evento): 740 ms / 1.740 ms con 12.000 eventos → 325 / 415 ms (§I).
2. **Resumen de marcas duplicaba el nombre** («Marca: X · X»): ahora dice qué pasó («Alta», «Activa → Inactiva»…).
3. **Columna Entidad de una palabra por renglón** en escritorio y scroll interno innecesario: anchos de celda propios.
4. **Pantallas denegadas sin título** (Usuarios y Auditoría para employee): se agregó el `h1`.

Revisados sin hallazgos: `NaN`/`undefined`/`null` visibles, inglés, pluralización
del paginador, botones sin nombre, rutas rotas (Configuración inexistente → 404),
«Cargando…» infinito, estados de error con reintentar.

## N. Deudas

| # | Deuda | Estado |
|---|---|---|
| 1 | **U-B-2 · maestro de productos y precios** | abierta; `PRODUCT_MASTER = STEL/LEGACY`, `PRICE_MASTER = UNDECIDED`, `PRICE_LISTS = READ_ONLY` |
| 2 | **Productos con escritura directa** (`products_write`: admin + employee por REST) | abierta (fase de Catálogo) |
| 3 | **SPF / DKIM / DMARC** (Google) | pendiente de DNS; no blocker |
| 4 | **Suites viejas de Ventas/Compras/Mantenimiento sobre Buscatools real** | portar a fixtures antes de volver a correrlas |
| 5 | Marcas legacy de 2 letras (BR, GE, KI, MI, NA, RR, SI, TO) | sin tocar |
| 6 | Categoría «Otros» con 12.588 productos en revisión | recategorización (Catálogo) |
| 7 | Listas de prueba («Especial Cliente Demo», «Distribuidores», Torquetools) | U-NB-6 |
| 8 | Atributos con tipo inconsistente (`rpm`, `catalogo_pagina`, `sufijos`) | sin tocar |
| 9 | Torquetools con datos incompletos (empresa, autoridad de numeración) | decisión |
| 10 | Cuenta «Admin» genérica | decidir si se conserva |
| 11 | Brian y Oscar sin alta | falta email + invitación |
| 12 | Rol de Facundo (salesperson vs employee) | decisión |
| 13 | Rediseño global | fuera de fase |
| 14 | «+ Nueva» visible para salesperson/technician en Ventas | inconsistencia de UI previa |
| 15 | `anon` con grants de tabla en ~37 tablas de otros módulos; DEFINER de `app` con EXECUTE a PUBLIC | preexistente, contenido por RLS / esquema no expuesto |
| 16 | Protección de contraseñas filtradas (Auth) deshabilitada | preexistente |
| 17 | `MIGRATION_STATUS.md` | no actualizado (deuda global, a pedido) |

## O. Coverage final (65 funcionalidades de la Entrega 0)

| # | Funcionalidad | Estado final | Dónde / por qué |
|---|---|---|---|
| F01 | Datos de empresa | MIGRADO | E2 |
| F02 | Logo de empresa | MIGRATED_WITH_CORRECTED_MODEL | bucket privado + URL firmada (E2) |
| F03 | WhatsApp en datos de empresa | NOT_MIGRATED_BY_DESIGN | vive en `whatsapp_accounts` |
| F04 | Color de marca | MIGRADO | editable en Empresa (E2) |
| F05 | Moneda base | ALREADY_SOLVED | dato del sistema, visible |
| F06 | Alta de empresas / GAS | BLOCKED_BY_DECISION | U-NB-1 |
| F07 | Selector de empresa activa | ALREADY_SOLVED | |
| F08 | Vista «TODAS» | NOT_MIGRATED_BY_DESIGN | mezclaba monedas |
| F09 | Login | ALREADY_SOLVED | |
| F10 | Invitación de usuario | MIGRATED_WITH_CORRECTED_MODEL | Edge Function con clave de servicio (E1) |
| F11 | Recuperación y cambio de contraseña | MIGRATED_WITH_CORRECTED_MODEL | flujo de Auth + SMTP (E1) |
| F12 | Rol / membresía por empresa | MIGRADO | E1, último admin protegido |
| F13 | Suspender / reactivar | MIGRADO | E1 |
| F14 | Permisos por sección / `allowed_sections` | BLOCKED_BY_DECISION | U-NB-3 (roles cubren hoy) |
| F15 | Cuentas de clientes (portal) | BLOCKED_BY_DECISION | decisión de portal |
| F16 | Vendedor / técnico | ALREADY_SOLVED | roles |
| F17 | Lista blanca `TEAM_USERS` | NOT_MIGRATED_BY_DESIGN | reemplazada por membresías |
| F18 | Contraseñas por defecto en el bundle | NOT_MIGRATED_BY_DESIGN | deuda del legacy (Phase 11) |
| F19 | Depósitos | FUTURE_FEATURE | cuando haya un segundo depósito |
| F20 | Monedas | ALREADY_SOLVED | |
| F21 | Tipo de cambio | FUTURE_FEATURE | U-NB-4 (schema + fuente) |
| F22 | Listas de precios | READ_ONLY_BY_AUTHORITY | E3, U-B-2 |
| F23 | Precios por producto y lista | READ_ONLY_BY_AUTHORITY | E3, U-B-2 |
| F24 | Actualización masiva de precios | BLOCKED_BY_DECISION | U-B-2 |
| F25 | Alta y edición de productos | BLOCKED_BY_DECISION | U-B-2 (maestro STEL/legacy) |
| F26 | Marcas | MIGRATED_WITH_CORRECTED_MODEL | sin renombrar, desactivar, borrar sin uso (E3) |
| F27 | Categorías y atributos | MIGRATED_WITH_CORRECTED_MODEL | categorías editables con slug fijo; atributos sólo lectura (E3) |
| F28 | Kits / repuestos | FUTURE_FEATURE | |
| F29 | Stock inicial / mín / máx en el alta | BLOCKED_BY_DECISION | parte del ABM de productos (U-B-2) |
| F30 | Rubros | ALREADY_SOLVED | Phase 5 |
| F31 | Condiciones de pago | FUTURE_FEATURE | U-NB-5 |
| F32 | Impuestos / tratamientos | ALREADY_SOLVED | regla en base |
| F33 | Secuencias | READ_ONLY_BY_AUTHORITY | Numeración visible; autoridad STEL/ERP (E2, E2.5) |
| F34 | Estados de documentos | ALREADY_SOLVED | |
| F35 | Opciones de impresión | ALREADY_SOLVED | |
| F36 | STEL | BLOCKED_BY_DECISION | ingesta y cutover; guardrail activo (E2.5) |
| F37 | Gmail | ALREADY_SOLVED | Fase 9 |
| F38 | WhatsApp | BLOCKED_BY_DECISION | pausado |
| F39 | Make | NOT_MIGRATED_BY_DESIGN | se retira con el legacy |
| F40 | Firebase | NOT_MIGRATED_BY_DESIGN | |
| F41 | Cloudflare PDF | NOT_MIGRATED_BY_DESIGN | |
| F42 | Tango | NOT_MIGRATED_BY_DESIGN | |
| F43 | Resend | NOT_MIGRATED_BY_DESIGN | retirado |
| F44 | IA en el navegador | NOT_MIGRATED_BY_DESIGN | |
| F45 | Mercado Libre / Amazon | NOT_MIGRATED_BY_DESIGN | |
| F46 | RLS de escritura de maestros | MIGRATED_WITH_CORRECTED_MODEL | escritura directa cerrada, RPC con lista blanca (E3) |
| F47 | Invitación sin exponer la clave de servicio | MIGRADO | Edge Function (E1) |
| F48 | Tema / apariencia | FUTURE_FEATURE | |
| F49 | Idioma | FUTURE_FEATURE | |
| F50 | Mi perfil | FUTURE_FEATURE | |
| F51 | Empresa activa persistida | ALREADY_SOLVED | |
| F52 | Paginación / sidebar colapsado persistidos | NOT_MIGRATED_BY_DESIGN | |
| F53 | Firma de email | NOT_MIGRATED_BY_DESIGN | |
| F54 | Widgets de dashboard | NOT_MIGRATED_BY_DESIGN | |
| F55 | Push FCM | NOT_MIGRATED_BY_DESIGN | |
| F56 | Backup / restore JSON | NOT_MIGRATED_BY_DESIGN | backups de base |
| F57 | Importaciones (scripts) | ALREADY_SOLVED | |
| F58 | Importar OC con IA | BLOCKED_BY_DECISION | |
| F59 | Export CSV | ALREADY_SOLVED | |
| F60 | Visor de auditoría | MIGRADO | **E4** |
| F61 | `renderCatalogoAdminPrecios` | NOT_MIGRATED_BY_DESIGN | código muerto |
| F62 | `_abrirEditOverride` | NOT_MIGRATED_BY_DESIGN | código muerto |
| F63 | `mant_usuarios` | NOT_MIGRATED_BY_DESIGN | código muerto |
| F64 | Conexiones › Amazon | NOT_MIGRATED_BY_DESIGN | placeholder |
| F65 | Emails › acceso por usuario | ALREADY_SOLVED | RLS por empresa en el servidor (Fase 9), no filtro del navegador |

**Totales:** MIGRADO 6 · MIGRATED_WITH_CORRECTED_MODEL 6 · ALREADY_SOLVED 14 ·
READ_ONLY_BY_AUTHORITY 3 · NOT_MIGRATED_BY_DESIGN 20 · BLOCKED_BY_DECISION 9 ·
FUTURE_FEATURE 7 = **65**. Ningún ítem sin clasificar.

## P. Criterio de cierre

| Criterio | Estado |
|---|---|
| Usuarios funciona | ✅ E1 (85/85) |
| Empresa funciona | ✅ E2 (71/71) |
| Logo seguro | ✅ bucket privado, validación de bytes, URL firmada |
| Numeración visible / sólo lectura | ✅ |
| Guardrail STEL activo | ✅ E2.5 (46/46); Buscatools ×3 STEL, Torquetools sin filas |
| Listas sólo lectura | ✅ E3 |
| Marcas / categorías seguras | ✅ E3 (70/70) |
| Atributos resueltos | ✅ sólo lectura, explícitamente fuera de edición |
| Auditoría admin-only | ✅ E4 (39/39) |
| Cross-company bloqueado | ✅ E1–E4 |
| Escrituras directas cerradas | ✅ (productos: deuda N.2, fuera de Configuración) |
| Mobile | ✅ 390 · 430 · 768 · 1440 |
| Tests | ✅ |
| CI / deploy | ⏳ al aprobar el push de esta entrega |
| Coverage final completa | ✅ 65/65 |
| Deudas explícitas | ✅ §N |

**PHASE 12 · CONFIGURACIÓN puede cerrarse** una vez que el push de esta entrega
pase CI, deploy y la revisión en producción.

**Archivos**

- Base: `docs/database/PHASE_12_CONFIGURACION_ENTREGA_4.sql`.
- Configuración: `lib/auditoria.ts` (+test), `services/auditoria.ts`, `hooks/useAuditoria.ts`, `pages/AuditoriaPage.tsx` (+test), `pages/UsuariosPage.tsx`, `lib/permisos.ts`, `lib/usuarios.test.ts`, `components/Configuracion.module.css`.
- App: `src/app/routes.tsx`, `src/types/database.types.ts`.
- Scripts: `scripts/fase12-configuracion-entrega4-tests.mjs`, `scripts/fase12-configuracion-entrega4-ui-fixture.mjs`.
