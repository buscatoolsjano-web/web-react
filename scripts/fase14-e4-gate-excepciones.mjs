/**
 * Fase 14 · Entrega 4 — GATE de las excepciones autorizadas (SÓLO LECTURA).
 *
 * Revalida, con la lectura de STEL del dry run de ESTA corrida (0 llamadas extra)
 * y consultas a React, las cinco excepciones que el usuario autorizó condicionalmente:
 *
 *   A · COTI02530        → estado STEL «Pendiente», sin derivados, sin eventos
 *   B · SP.2008VP/100    → mismo id STEL, SKU/marca/medida/largo siguen coincidiendo
 *   C · las 8 líneas     → 0 referencias, 0 stock, 0 eventos, STEL no las reincorporó
 *   D · COTI02452        → CUIT inequívoco en STEL y sin conflicto en React
 *   E · SP.2007VPM/80    → se mantiene el conflicto humano (nunca se aplica)
 *
 * Cada caso sale como APLICAR o RETENER con el motivo. Lo que sale RETENER no
 * entra en el plan: el script de aplicación lee este mismo archivo.
 *
 *   set -a; . ./.env; . ./.env.migration; set +a
 *   node scripts/fase14-e4-gate-excepciones.mjs --plan-hash <sha256 del dry run>
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs'
import path from 'node:path'

const BASE = process.env.VITE_SUPABASE_URL
const SECRET = process.env.SUPABASE_SECRET_KEY
if (!BASE || !SECRET) { console.error('✗ Faltan variables'); process.exit(1) }
const sb = createClient(BASE, SECRET, { auth: { persistSession: false } })

const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null }
const SALIDA = path.resolve('scripts/output/e4')
const E2 = path.resolve('scripts/output/e2')

const normTexto = (s) => (s ?? '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const normCuit = (s) => (s ?? '').toString().replace(/\D/g, '') || null
/** Atributos estructurados de la descripción de STEL: «Medida: 8 mm», «Largo: 100 mm». */
const atributo = (texto, etiqueta) => {
  const m = (texto ?? '').match(new RegExp(`${etiqueta}\\s*:?\\s*([0-9]+(?:[.,][0-9]+)?)\\s*(?:mm|milimetros|milímetros)?`, 'i'))
  return m ? Number(m[1].replace(',', '.')) : null
}
const marca = (texto) => ((texto ?? '').match(/marca\s*:?\s*([A-Za-zÁÉÍÓÚÑ0-9.\- ]+)/i)?.[1] ?? '').trim()

export const CASOS = ['coti02530', 'sp2008', 'lineas', 'coti02452', 'sp2007']

/** Decisión pura: entra todo lo medido, sale APLICAR/RETENER con motivo. */
export function decidir(caso, e) {
  switch (caso) {
    case 'coti02530': {
      const ok = e.estadoStel === 'Pendiente' && e.derivadosStel === 0 && e.derivadosReact === 0 && e.eventos === 0 && e.reactImportado && e.estadoReact === 'accepted'
      return {
        decision: ok ? 'APLICAR' : 'RETENER',
        motivo: ok
          ? 'STEL sigue reportándola Pendiente, sigue sin documentos derivados en STEL y en React, y no hay eventos que contradigan el cambio.'
          : e.estadoStel !== 'Pendiente' ? `STEL ya no la reporta Pendiente (${e.estadoStel}): la autorización no cubre este estado.`
            : e.derivadosStel || e.derivadosReact ? 'Apareció un documento derivado: bajar el estado dejaría un hijo colgando.'
              : e.eventos ? 'Hay eventos del documento que habría que revisar antes.'
                : e.estadoReact !== 'accepted' ? `React ya no está en accepted (${e.estadoReact}).` : 'No está importada.',
      }
    }
    case 'sp2008': {
      const ok = e.mismoIdStel && e.skuIgual && e.marcaIgual && e.medidaIgual && e.largoIgual && !e.reactYaVinculado && !e.stelBorrado
      return {
        decision: ok ? 'APLICAR' : 'RETENER',
        motivo: ok
          ? 'El id STEL sigue siendo el mismo artículo y coinciden SKU exacto, marca, medida 8 mm y largo 100 mm.'
          : !e.mismoIdStel ? 'El id STEL que usan las líneas cambió: la evidencia autorizada ya no vale.'
            : e.reactYaVinculado ? 'El producto React ya tiene otro id externo.'
              : e.stelBorrado ? 'El artículo está borrado o inactivo en STEL.'
                : `Dejaron de coincidir los atributos estructurados (sku=${e.skuIgual}, marca=${e.marcaIgual}, medida=${e.medidaIgual}, largo=${e.largoIgual}).`,
      }
    }
    case 'lineas': {
      const ok = e.referencias === 0 && e.movimientos === 0 && e.eventos === 0 && !e.stelLaReincorporo && e.intactaDesdeE2
      return {
        decision: ok ? 'APLICAR' : 'RETENER',
        motivo: ok
          ? 'Sin referencias aguas abajo, sin movimientos de stock, sin eventos, idéntica al respaldo de E2 y STEL no volvió a incorporarla.'
          : e.stelLaReincorporo ? 'STEL volvió a incorporar esa línea: ya no sobra.'
            : e.referencias ? 'Algo aguas abajo la referencia.'
              : e.movimientos ? 'El remito tiene movimientos de stock.'
                : e.eventos ? 'El documento tiene eventos.' : 'La fila cambió desde el respaldo de E2.',
      }
    }
    case 'coti02452': {
      const ok = Boolean(e.cuitStel) && e.cuitValido && e.otrosClientesConEseCuit === 0 && e.cuitReactActual === null && e.clienteUnico
      return {
        decision: ok ? 'APLICAR' : 'RETENER',
        motivo: ok
          ? 'STEL trae un CUIT inequívoco, el cliente React vinculado no tiene CUIT cargado y ningún otro cliente de la empresa usa ese número.'
          : !e.cuitStel ? 'STEL no trae CUIT para esa cuenta.'
            : !e.cuitValido ? 'El identificador de STEL no tiene forma de CUIT/NIF.'
              : e.otrosClientesConEseCuit ? 'Otro cliente de React ya usa ese CUIT: hay conflicto de identidad.'
                : e.cuitReactActual ? `El cliente React ya tiene CUIT cargado (${e.cuitReactActual === e.cuitStel ? 'el mismo' : 'distinto'}).`
                  : 'La cuenta de STEL no resuelve a un solo cliente de React.',
      }
    }
    case 'sp2007':
      return { decision: 'RETENER', motivo: 'DATA_CONFLICT_REQUIRES_HUMAN: el conflicto está dentro de STEL (nombre 65 mm vs descripción 80 mm vs SKU /80). No se modifica.' }
    default:
      throw new Error(`caso desconocido: ${caso}`)
  }
}

async function main() {
  const hash = arg('--plan-hash')
  if (!/^[0-9a-f]{64}$/.test(hash ?? '')) { console.error('✗ falta --plan-hash <sha256 del dry run>'); process.exit(2) }
  const corto = hash.slice(0, 12)
  const fStel = path.join(E2, `stel-dryrun-${corto}.json`)
  const fPlan = path.join(E2, `plan-${corto}.json`)
  const fRespaldoE2 = path.join(E2, 'respaldo-aplicar-e62de165c350.json')
  for (const f of [fStel, fPlan, fRespaldoE2]) if (!fs.existsSync(f)) { console.error(`✗ falta ${path.relative(process.cwd(), f)}`); process.exit(2) }
  const { stel, leidoEn } = JSON.parse(fs.readFileSync(fStel, 'utf8'))
  const plan = JSON.parse(fs.readFileSync(fPlan, 'utf8'))
  const respaldoE2 = JSON.parse(fs.readFileSync(fRespaldoE2, 'utf8')).filas
  const { data: emp } = await sb.from('companies').select('id').eq('slug', 'buscatools').single()
  const BT = emp.id
  const estados = new Map(stel.estados.map((e) => [e.id, e.name]))
  const out = { generado: new Date().toISOString(), stelLeidoEn: leidoEn, planHash: hash, llamadasStelExtra: 0, casos: {} }

  // ── A · COTI02530 ──────────────────────────────────────────────────────────
  const q30 = stel.docs.quote.find((d) => d['full-reference'] === 'COTI02530')
  const { data: r30 } = await sb.from('sales_quotes').select('id, status, currency_code, external_id, imported_at').eq('company_id', BT).eq('number', 'COTI02530').single()
  const { count: ped30 } = await sb.from('sales_orders').select('*', { count: 'exact', head: true }).eq('quote_id', r30.id)
  const { count: rem30 } = await sb.from('deliveries').select('*', { count: 'exact', head: true }).eq('source_quote_id', r30.id)
  const { count: ev30 } = await sb.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', r30.id)
  const derivadosStel = ['order', 'delivery'].reduce((n, t) => n + stel.docs[t].filter((d) => d['parent-document-id'] === q30?.id || (d.lines ?? []).some((l) => l['parent-document-id'] === q30?.id)).length, 0)
  const ev30A = {
    estadoStel: q30 ? estados.get(q30['document-state-id']) ?? String(q30['document-state-id']) : null,
    modificadoStel: q30?.['utc-last-modification-date'] ?? null,
    derivadosStel, derivadosReact: (ped30 ?? 0) + (rem30 ?? 0), eventos: ev30 ?? 0,
    estadoReact: r30.status, reactImportado: Boolean(r30.imported_at), idStelEnReact: r30.external_id,
    stelId: q30 ? String(q30.id) : null,
  }
  out.casos.coti02530 = { evidencia: ev30A, ...decidir('coti02530', ev30A), accion: 'status accepted→sent + vincular id STEL' }

  // ── B/E · productos bloqueados ─────────────────────────────────────────────
  for (const [caso, sku, medidaEsperada, largoEsperado] of [['sp2008', 'SP.2008VP/100', 8, 100], ['sp2007', 'SP.2007VPM/80', null, null]]) {
    const it = stel.productos.find((p) => p['full-reference'] === sku) ?? null
    const { data: rp } = await sb.from('products').select('id, sku, name, description, external_source, external_id, brand_id, status').eq('company_id', BT).eq('sku', sku).maybeSingle()
    const { data: mk } = rp?.brand_id ? await sb.from('brands').select('name').eq('id', rp.brand_id).maybeSingle() : { data: null }
    const idsEnLineas = new Set(['quote', 'order', 'delivery'].flatMap((t) => stel.docs[t].flatMap((d) => (d.lines ?? []).filter((l) => l['item-reference'] === sku && !l.deleted).map((l) => String(l['item-id'])))))
    const ev = {
      stelId: it ? String(it.id) : null,
      mismoIdStel: Boolean(it) && idsEnLineas.size === 1 && idsEnLineas.has(String(it.id)),
      idsDeItemEnLineas: [...idsEnLineas],
      skuIgual: it?.['full-reference'] === rp?.sku,
      marcaIgual: normTexto(marca(it?.description)) === normTexto(mk?.name) && Boolean(mk?.name),
      medidaIgual: medidaEsperada === null ? null : atributo(it?.description, 'medida') === medidaEsperada,
      largoIgual: largoEsperado === null ? null : atributo(it?.description, 'largo') === largoEsperado,
      reactYaVinculado: Boolean(rp?.external_id),
      stelBorrado: Boolean(it?.deleted || it?.inactive),
      modificadoStel: it?.['utc-last-modification-date'] ?? null,
      nombreStel: it?.name ?? null, nombreReact: rp?.name ?? null,
      largoEnNombreStel: atributo(it?.name, 'largo mm') ?? atributo(it?.name, 'mm'),
      largoEnDescripcionStel: atributo(it?.description, 'largo'),
      productoReactId: rp?.id ?? null,
    }
    out.casos[caso] = { sku, evidencia: ev, ...decidir(caso, ev), accion: caso === 'sp2008' ? 'vincular producto React ↔ id STEL' : 'ninguna' }
  }

  // ── C · las 8 líneas ───────────────────────────────────────────────────────
  out.casos.lineas = { total: plan.pendientesBorrado.length, detalle: [] }
  for (const p of plan.pendientesBorrado) {
    const tabla = p.tipo === 'quote' ? 'sales_quote_lines' : 'delivery_lines'
    const { data: ahora } = await sb.from(tabla).select('*').eq('id', p.react_linea_id).maybeSingle()
    const previa = respaldoE2[tabla].find((r) => r.id === p.react_linea_id)
    const docId = p.tipo === 'quote' ? ahora?.quote_id : ahora?.delivery_id
    const { count: refs } = p.tipo === 'quote'
      ? await sb.from('sales_order_lines').select('*', { count: 'exact', head: true }).eq('quote_line_id', p.react_linea_id)
      : { count: 0 }
    const { count: movs } = p.tipo === 'delivery'
      ? await sb.from('stock_movements').select('*', { count: 'exact', head: true }).eq('source_type', 'delivery').eq('source_id', docId)
      : { count: 0 }
    const { count: eventos } = await sb.from('sales_audit').select('*', { count: 'exact', head: true }).eq('entity_id', docId)
    const doc = stel.docs[p.tipo].find((d) => d['full-reference'] === p.numero)
    const items = (doc?.lines ?? []).filter((l) => !l.deleted && l['line-type'] === 'ITEM')
    const enStel = items.filter((l) => l['item-reference'] === p.sku).length
    const enReact = (await sb.from(tabla).select('id', { count: 'exact', head: true }).eq(p.tipo === 'quote' ? 'quote_id' : 'delivery_id', docId).eq('sku_snapshot', p.sku)).count ?? 0
    const ev = {
      referencias: refs ?? 0, movimientos: movs ?? 0, eventos: eventos ?? 0,
      // Sobra si React tiene más renglones de ese SKU que STEL (o STEL no lo tiene).
      stelLaReincorporo: enStel >= enReact,
      intactaDesdeE2: Boolean(ahora) && Boolean(previa) && JSON.stringify(Object.keys(previa).sort().map((k) => [k, previa[k]])) === JSON.stringify(Object.keys(ahora).sort().map((k) => [k, ahora[k]])),
      lineasStelDelDocumento: items.length, skuEnStel: enStel, skuEnReact: enReact,
      modificadoStel: doc?.['utc-last-modification-date'] ?? null,
    }
    out.casos.lineas.detalle.push({ documento: p.numero, sku: p.sku, id: p.react_linea_id, tipo: p.tipo, evidencia: ev, ...decidir('lineas', ev) })
  }
  out.casos.lineas.aplicables = out.casos.lineas.detalle.filter((x) => x.decision === 'APLICAR').length
  out.casos.lineas.decision = out.casos.lineas.aplicables === out.casos.lineas.total ? 'APLICAR' : out.casos.lineas.aplicables ? 'APLICAR_PARCIAL' : 'RETENER'

  // ── D · COTI02452 ──────────────────────────────────────────────────────────
  const q52 = stel.docs.quote.find((d) => d['full-reference'] === 'COTI02452')
  const cliStel = stel.clientes.find((c) => c.id === q52?.['account-id']) ?? null
  const cuit = normCuit(cliStel?.['tax-identification-number'])
  const { data: r52 } = await sb.from('sales_quotes').select('customer_id').eq('company_id', BT).eq('number', 'COTI02452').single()
  const { data: cliReact } = await sb.from('customers').select('id, tax_id, legal_name').eq('id', r52.customer_id).single()
  const { data: conEseCuit } = await sb.from('customers').select('id, tax_id').eq('company_id', BT).not('tax_id', 'is', null)
  const otros = (conEseCuit ?? []).filter((c) => normCuit(c.tax_id) === cuit && c.id !== cliReact.id)
  // Todos los documentos de la cuenta STEL tienen que apuntar al mismo cliente React.
  const refsCuenta = ['quote', 'order', 'delivery'].flatMap((t) => stel.docs[t].filter((d) => d['account-id'] === cliStel?.id).map((d) => ({ t, ref: d['full-reference'] })))
  const tablas = { quote: 'sales_quotes', order: 'sales_orders', delivery: 'deliveries' }
  const clientesDeLaCuenta = new Set()
  for (const r of refsCuenta) {
    const { data } = await sb.from(tablas[r.t]).select('customer_id').eq('company_id', BT).eq('number', r.ref).maybeSingle()
    if (data?.customer_id) clientesDeLaCuenta.add(data.customer_id)
  }
  const ev52 = {
    cuentaStel: cliStel?.id ?? null, referenciaStel: cliStel?.['full-reference'] ?? null,
    cuitStel: cuit, cuitValido: Boolean(cuit) && cuit.length === 11,
    cuitReactActual: normCuit(cliReact.tax_id), otrosClientesConEseCuit: otros.length,
    clienteReact: cliReact.id, documentosDeLaCuenta: refsCuenta.length,
    clientesReactDeEsaCuenta: clientesDeLaCuenta.size, clienteUnico: clientesDeLaCuenta.size === 1 && clientesDeLaCuenta.has(cliReact.id),
  }
  out.casos.coti02452 = { evidencia: ev52, ...decidir('coti02452', ev52), accion: 'cargar el CUIT de STEL en el cliente React (identidad fuerte)' }

  // ── Últimos de STEL ────────────────────────────────────────────────────────
  const ultimo = (t) => [...stel.docs[t]].sort((a, b) => String(a['full-reference']).localeCompare(String(b['full-reference']))).at(-1)?.['full-reference'] ?? null
  out.latestStel = { LATEST_QUOTE: ultimo('quote'), LATEST_ORDER: ultimo('order'), LATEST_DELIVERY: ultimo('delivery') }

  fs.mkdirSync(SALIDA, { recursive: true })
  const archivo = path.join(SALIDA, `gate-${corto}.json`)
  fs.writeFileSync(archivo, JSON.stringify(out, null, 1))
  const publico = structuredClone(out)
  delete publico.casos.coti02452.evidencia.cuitStel
  delete publico.casos.coti02452.evidencia.cuitReactActual
  console.log(JSON.stringify(publico, null, 1))
  console.log(`  detalle: ${path.relative(process.cwd(), archivo)} (ignorado)`)
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((e) => { console.error('✗', e.message); process.exit(1) })
}
