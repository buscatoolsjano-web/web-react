/**
 * Fase 12 · Configuración — Entrega 0: inventario del legacy. SÓLO LECTURA.
 *
 * Análisis estático del respaldo legacy (app.js) y de las rutas/permisos de
 * React en este repo. No hace requests, no toca bases, no escribe nada salvo el
 * JSON de salida si se pide. Nunca imprime literales de secretos ni UUID.
 *
 *   node scripts/fase12-configuracion-auditoria.mjs <dir-legacy> [salida.json]
 *   node scripts/fase12-configuracion-auditoria.mjs --sql
 *
 * `--sql` imprime las consultas de schema y datos (sólo lectura) usadas en la
 * auditoría, para repetirlas por MCP.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SQL = `-- tablas de configuración: columnas, CHECKs y policies
select c.relname, (select string_agg(column_name||':'||data_type, ', ' order by ordinal_position) from information_schema.columns col
  where col.table_schema='public' and col.table_name=c.relname) cols,
 (select string_agg(pg_get_constraintdef(k.oid), ' | ') from pg_constraint k where k.conrelid=c.oid and k.contype='c') checks,
 (select string_agg(p.policyname||'('||p.cmd||')', ', ') from pg_policies p where p.tablename=c.relname) policies
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('companies','company_memberships','profiles','warehouses','price_lists','product_prices',
  'document_sequences','currencies','brands','product_categories','product_attribute_definitions');

-- datos (sin valores sensibles: completitud por campo y conteos)
select slug, legal_name is not null, tax_id is not null, address is not null, logo_path is not null, default_currency, is_active from companies;
select c.slug, m.role, m.status, count(*) from company_memberships m join companies c on c.id=m.company_id group by 1,2,3;
select c.slug, pl.name, pl.currency_code, pl.is_default, (select count(*) from product_prices pp where pp.price_list_id=pl.id)
from price_lists pl join companies c on c.id=pl.company_id;
select c.slug, doc_type, prefix, padding, next_number from document_sequences ds join companies c on c.id=ds.company_id;
select count(*) filter (where default_price_list_id is not null), count(*) filter (where salesperson_id is not null) from customers;

-- helpers de rol
select proname, prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='app' and proname in ('is_admin','current_role','is_internal','current_writer_company_ids','current_price_list_ids','tasa_de_tratamiento');`

if (process.argv.includes('--sql')) { console.log(SQL); process.exit(0) }

const dir = process.argv[2]
if (!dir) { console.error('uso: node scripts/fase12-configuracion-auditoria.mjs <dir-legacy> [salida.json] | --sql'); process.exit(1) }
const salida = process.argv[3] ?? null
const app = readFileSync(join(dir, 'app.js'), 'utf8')
const html = readFileSync(join(dir, 'index.html'), 'utf8')
const lineas = app.split('\n')
const decl = []
lineas.forEach((l, i) => { const m = l.match(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/); if (m) decl.push([i + 1, m[1]]) })
// Las referencias cuentan app.js e index.html: varios modales se abren desde onclick del HTML.
const conteoIdent = new Map()
for (const m of (app + '\n' + html).matchAll(/[A-Za-z_$][\w$]*/g)) conteoIdent.set(m[0], (conteoIdent.get(m[0]) ?? 0) + 1)
const linea = (re) => { const i = lineas.findIndex((l) => re.test(l)); return i < 0 ? null : i + 1 }
const refs = (nombre) => (conteoIdent.get(nombre) ?? 1) - 1

// Superficies de configuración/administración del legacy (función → qué hace).
const SUPERFICIES = [
  ['abrirEditorEmpresa', 'Datos de empresa: logo, razón social, CUIT, dirección, teléfono, WhatsApp, email, web → erp_empresas_override (localStorage)'],
  ['abrirEmpresaPicker', 'Selector de empresa (EMPRESAS hardcodeadas + empresas por usuario)'],
  ['abrirAdminUsuariosModal', 'Admin usuarios (sólo ADMIN): contraseña, permisos por sección, empresas por usuario; cuentas de clientes'],
  ['abrirCambiarPassModal', 'Cambio de contraseña propia'],
  ['abrirCrearCuentaModal', 'Alta de cuenta de visitante/cliente'],
  ['abrirTemaModal', 'Preferencias: plantilla de tema, color de acento, tamaño y familia de fuente (erp_prefs_<usuario>)'],
  ['mostrarAiConfigModal', 'Configuración de IA (claves en el navegador)'],
  ['renderEmailsConfig', 'Emails › Configuración (acceso por usuario, URLs de webhooks)'],
  ['renderConfig', 'WhatsApp › Configuración (estado Baileys/QR)'],
  ['renderConexiones', 'Conexiones: Mercado Libre / Amazon'],
  ['_renderPushNotifSection', 'Notificaciones push (FCM) por dispositivo'],
  ['renderRubrosAdmin', 'Clientes › Rubros y catálogos'],
  ['_abrirModalNuevoProducto', 'Alta de producto (y edición vía _abrirEditProducto)'],
  ['_npCrearMarca', 'Alta de marca desde el modal de producto'],
  ['renderCatalogoAdminPrecios', 'Admin de precios/stock (overrides locales)'],
  ['loadPrintOpts', 'Opciones de impresión: valorado, imágenes, papel, carta, precios con impuestos (erp_print_opts)'],
  ['_mantExportarView', 'Mantenimiento › Exportar: CSV + backup/restore JSON'],
  ['renderTrazabilidad', 'Trazabilidad (sólo ADMIN)'],
  ['renderFinanzasTC', 'Finanzas › Tipos de cambio (dolarapi.com)'],
  ['nextCotRef', 'Numeración de cotizaciones (máximo + 1 en el navegador)'],
]
const superficies = SUPERFICIES.map(([f, que]) => {
  const d = decl.find((x) => x[1] === f)
  return { funcion: f, linea: d?.[0] ?? null, referencias: refs(f), estado: !d ? 'NO_EXISTE' : refs(f) === 0 ? 'DEAD_CODE' : 'REAL', que }
})

// Claves de persistencia relacionadas con configuración.
const CLAVES = ['erp_empresas_override', 'erp_session_empresa', 'erp_auth_users', 'erp_user_perms', 'erp_client_accounts', 'erp_prefs_',
  'erp_print_opts', 'erp_ai_config', 'erp_openai_key', 'erp_emails_access', 'erp_emails_webhook_reply', 'erp_emails_webhook_sync',
  'erp_conexiones', 'erp_push_fcm_token', 'erp_producto_overrides', 'erp_finanzas_rates', 'buscatools_rubros_config',
  'erp_dash_widget_cfg_', 'erp_ln_collapsed', 'bt_wa_settings']
const claves = CLAVES.map((k) => ({ clave: k, referencias: (app.match(new RegExp(k.replace(/[_]/g, '_'), 'g')) ?? []).length }))

// Constantes estructurales (ubicación, sin valores).
const constantes = {
  EMPRESAS: linea(/^const EMPRESAS = \[/),
  TEAM_USERS: linea(/^const TEAM_USERS = /),
  PERM_SECCIONES: linea(/^const PERM_SECCIONES = /),
  SUPA_WAREHOUSE_ID: linea(/^const SUPA_WAREHOUSE_ID = /),
  DEFAULT_PRINT_OPTS: linea(/^const DEFAULT_PRINT_OPTS = /),
  RUBROS_SEED: linea(/^const RUBROS_SEED = /),
  _TEMAS: linea(/^const _TEMAS = /),
  precio_pu_x3: linea(/p\.pu \* 3/),
}
const teamUsers = (app.match(/const TEAM_USERS = \[([^\]]+)\]/)?.[1] ?? '').split(',').length
const permSecciones = (app.match(/const PERM_SECCIONES = \[([^\]]+)\]/)?.[1] ?? '').split(',').length
const empresas = (app.slice(app.indexOf('const EMPRESAS = ['), app.indexOf('const EMPRESA_DEFAULT')).match(/id: '([a-z]+)'/g) ?? []).length
const numeradores = decl.filter(([, n]) => /^next[A-Z][A-Za-z]*Ref$/.test(n)).map(([l, n]) => `${n}:${l}`)

// Temas buscados: cantidad de líneas que los mencionan.
const TEMAS = {
  configuracion: /configuraci[oó]n|settings/i, usuarios: /usuario|TEAM_USERS|authUsers/i, roles: /\brole\b|\brol\b/i, permisos: /perm(iso|s)\b|getPermsFor/i,
  empresa: /empresa/i, deposito: /dep[oó]sito|warehouse/i, moneda: /moneda|currency/i, tipo_cambio: /tipo de cambio|cotizaci[oó]n del d[oó]lar|dolarapi|\bTC\b/i,
  listas_precios: /lista de precios|price_list|precio_venta|precioVenta/i, numeracion: /next[A-Z][A-Za-z]*Ref|numeraci[oó]n/i,
  condicion_pago: /formaPago|condici[oó]n de pago|payment_terms/i, impuestos: /\biva\b|ivaAmount|iibb|impuesto/i,
  backup: /backup|restaur/i, importacion: /FileReader|import(ar|aci[oó]n)/i, auditoria: /trazabilidad|audit/i,
  integraciones: /stelorder|tangofactura|make\.com|firebaseio|wappfly|mercadolibre|sellercentral/i, notificaciones: /push|fcm|notificaci/i,
}
const temas = Object.fromEntries(Object.entries(TEMAS).map(([k, re]) => [k, lineas.filter((l) => re.test(l)).length]))

// React: rutas y constantes de roles.
const raiz = process.cwd()
const rutas = [...readFileSync(join(raiz, 'src/app/routes.tsx'), 'utf8').matchAll(/path: '([^']+)'/g)].map((x) => x[1])
const rutasConfig = rutas.filter((r) => /config|admin|usuario|user|empresa|company|deposit|warehouse|precio|price|secuenc/i.test(r))
const archivos = []
const rec = (d) => readdirSync(d).forEach((e) => { const p = join(d, e); statSync(p).isDirectory() ? rec(p) : /\.tsx?$/.test(e) && archivos.push(p) })
rec(join(raiz, 'src'))
const constantesRoles = [...new Set(archivos.flatMap((p) => [...readFileSync(p, 'utf8').matchAll(/export const (ROLES_[A-Z_]+) = \[([^\]]*)\]/g)].map((m) => `${m[1]} = [${m[2]}]`)))]
const modulosVacios = ['configuracion', 'whatsapp'].map((m) => ({ modulo: m, archivos: archivos.filter((p) => p.includes(join('modules', m))).length }))

const inventario = { superficies, claves, constantes, teamUsers, permSecciones, empresas, numeradores, temas, react: { rutasConfig, constantesRoles, modulosVacios } }
console.log(`superficies de configuración/admin: ${superficies.length} · REAL ${superficies.filter((s) => s.estado === 'REAL').length} · DEAD_CODE ${superficies.filter((s) => s.estado === 'DEAD_CODE').length}`)
for (const s of superficies) console.log(`  ${s.estado.padEnd(9)} ${String(s.linea).padStart(5)} ${s.funcion.padEnd(28)} ${s.que}`)
console.log(`constantes (línea): ${Object.entries(constantes).map(([k, v]) => `${k}@${v}`).join(' ')}`)
console.log(`TEAM_USERS: ${teamUsers} · PERM_SECCIONES: ${permSecciones} · EMPRESAS hardcodeadas: ${empresas} · numeradores: ${numeradores.join(' ')}`)
console.log(`claves de storage: ${claves.map((c) => `${c.clave}(${c.referencias})`).join(' ')}`)
console.log(`temas (líneas): ${Object.entries(temas).map(([k, v]) => `${k}=${v}`).join(' ')}`)
console.log(`React · rutas de configuración: ${rutasConfig.length ? rutasConfig.join(', ') : 'ninguna'} · módulos vacíos: ${modulosVacios.map((m) => `${m.modulo}(${m.archivos})`).join(' ')}`)
console.log(`React · constantes de rol: ${constantesRoles.join(' | ')}`)
if (salida) { writeFileSync(salida, JSON.stringify(inventario, null, 2)); console.log(`inventario → ${salida}`) }
