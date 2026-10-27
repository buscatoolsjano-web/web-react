import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog } from '@/components/modals/Dialog'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input, Select } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useCategorias, useFacetas, useMarcas } from '../hooks/useCatalogoFacetas'
import {
  CAMPOS_FIJOS,
  campoDeAtributo,
  describirCambio,
  puedeAplicar,
  type CampoMasivo,
} from '../lib/edicionMasiva'
import { editarProductosMasivo, type AvanceMasivo } from '../services/edicionMasiva'
import { FILTROS_INICIALES, type DefinicionAtributo, type FiltrosCatalogo } from '../types'
import styles from './ModalEdicionMasiva.module.css'

/** Sentinela del Select: «quiero escribir un valor que no está en la lista». */
const OTRO = '\u0000otro'

export interface ModalEdicionMasivaProps {
  /** Los ids de los productos elegidos. La pantalla manda SÓLO estos. */
  ids: readonly string[]
  /**
   * La categoría que comparten TODOS los elegidos, si es una sola. Con eso el
   * Tipo y las características se ofrecen con las opciones que ya existen en esa
   * categoría —como el filtro guiado—, en vez de texto libre. `null` cuando los
   * elegidos están en varias categorías (o ninguna): ahí se cae a texto.
   */
  categoriaComun: string | null
  definiciones: readonly DefinicionAtributo[]
  onCerrar: () => void
  /** Se llamó con cuántos se cambiaron, para refrescar el catálogo y avisar. */
  onAplicado: (cuantos: number) => void
}

/**
 * Editar muchos productos de un saque (Fase 137).
 *
 * «Que los administradores puedan modificar los productos masivamente.» Un
 * campo, un valor, todos los elegidos. No es el editor completo repetido: es la
 * herramienta para «a estos 40 ponéles la misma marca», que a mano es un
 * suplicio. Guía en dos pasos —qué cambiar y a qué— y pide confirmación antes
 * de tocar nada, porque el cambio no se deshace con Ctrl-Z.
 *
 * La referencia (SKU) no está: es la clave única por empresa, y ponerle el
 * mismo valor a varios los haría chocar. Eso se corrige uno por uno.
 */
export function ModalEdicionMasiva({ ids, categoriaComun, definiciones, onCerrar, onAplicado }: ModalEdicionMasivaProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const marcas = useMarcas(companyId)
  const categorias = useCategorias(companyId)
  const queryClient = useQueryClient()

  // Las facetas de la categoría común: de acá salen los tipos (product_type) y
  // los valores de cada atributo que YA existen en esa categoría.
  const filtroCategoria = useMemo<FiltrosCatalogo>(
    () => ({ ...FILTROS_INICIALES, categoria: categoriaComun }),
    [categoriaComun],
  )
  const { data: facetas } = useFacetas(categoriaComun ? companyId : null, filtroCategoria)
  const tiposDeCategoria = useMemo(() => (facetas?.subtipos ?? []).map((s) => s.valor), [facetas])

  const [campo, setCampo] = useState<CampoMasivo | null>(null)
  const [esAtributo, setEsAtributo] = useState(false)
  const [valor, setValor] = useState('')
  // true cuando, teniendo opciones, se eligió «Otro…» para escribir una nueva.
  const [modoLibre, setModoLibre] = useState(false)
  const [confirmando, setConfirmando] = useState(false)
  const [avance, setAvance] = useState<AvanceMasivo | null>(null)

  const elegirCampo = (c: CampoMasivo | null, atributo: boolean) => {
    setCampo(c)
    setEsAtributo(atributo)
    setValor('')
    setModoLibre(false)
    setConfirmando(false)
  }

  const aplicar = useMutation({
    mutationFn: () => editarProductosMasivo(companyId!, ids, campo!.rpc, valor, setAvance),
    onSuccess: async (n) => {
      await queryClient.invalidateQueries({ queryKey: ['catalogo'] })
      onAplicado(n)
    },
  })

  const listo = puedeAplicar(campo, valor, ids.length)
  const cerrar = () => {
    if (aplicar.isPending) return
    onCerrar()
  }

  /**
   * Un Select con las opciones que ya existen, más «Otro…» para escribir una
   * nueva. Es lo que baja el margen de error: se elige de lo que hay y no se
   * reescribe «1/4 Hex» cuando ya existe «1/4 HEX».
   */
  const selectConOpciones = (opciones: readonly string[], vacioLabel: string) => {
    if (modoLibre) {
      return (
        <div className={styles.libre}>
          <Input value={valor} autoFocus placeholder="Escribí el valor nuevo" onChange={(e) => setValor(e.target.value)} />
          <Button variant="ghost" size="sm" onClick={() => { setModoLibre(false); setValor('') }}>
            Elegir de la lista
          </Button>
        </div>
      )
    }
    return (
      <Select
        value={valor}
        onChange={(e) => {
          if (e.target.value === OTRO) { setModoLibre(true); setValor('') }
          else setValor(e.target.value)
        }}
      >
        <option value="">{vacioLabel}</option>
        {opciones.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
        <option value={OTRO}>Otro…</option>
      </Select>
    )
  }

  /** El control del valor según el campo elegido. */
  const control = () => {
    if (campo === null) return null
    if (campo.tipo === 'marca') {
      return (
        <Select value={valor} onChange={(e) => setValor(e.target.value)}>
          <option value="">Sin marca</option>
          {(marcas.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nombre}
            </option>
          ))}
        </Select>
      )
    }
    if (campo.tipo === 'categoria') {
      return (
        <Select value={valor} onChange={(e) => setValor(e.target.value)}>
          <option value="">Elegí una categoría…</option>
          {(categorias.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Select>
      )
    }
    // El Tipo (product_type), con los que ya existen en la categoría común.
    if (campo.rpc === 'product_type' && categoriaComun && tiposDeCategoria.length > 0) {
      return selectConOpciones(tiposDeCategoria, 'Sin tipo')
    }
    // Una característica de lista: los valores que ya existen en la categoría.
    if (campo.tipo === 'atributo' && categoriaComun) {
      const faceta = facetas?.atributos.find((a) => a.key === campo.atributoKey && a.clase === 'enum')
      if (faceta && faceta.opciones.length > 0) {
        return selectConOpciones(faceta.opciones.map((o) => o.valor), 'Borrar el dato')
      }
    }
    return (
      <Input
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="Dejalo vacío para borrar el dato"
      />
    )
  }

  return (
    <Dialog
      open
      onClose={cerrar}
      title={`Editar ${ids.length} ${ids.length === 1 ? 'producto' : 'productos'}`}
      size="md"
      busy={aplicar.isPending}
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="secondary" onClick={cerrar} disabled={aplicar.isPending}>
            Cancelar
          </Button>
          {!confirmando ? (
            <Button
              icon={<Icon name="edit" size={16} />}
              disabled={!listo}
              onClick={() => setConfirmando(true)}
            >
              Aplicar cambio
            </Button>
          ) : (
            <Button
              icon={<Icon name="check" size={16} />}
              loading={aplicar.isPending}
              onClick={() => aplicar.mutate()}
            >
              {aplicar.isPending
                ? avance
                  ? `Aplicando… ${avance.hechos}/${avance.total}`
                  : 'Aplicando…'
                : 'Sí, aplicar'}
            </Button>
          )}
        </>
      }
    >
      {aplicar.error ? (
        <Alert tone="danger" role="alert" title="No se pudo aplicar">
          <p>{aplicar.error instanceof Error ? aplicar.error.message : String(aplicar.error)}</p>
        </Alert>
      ) : null}

      {/* ── Paso 1 · qué cambiar ──────────────────────────────────────────── */}
      <p className={styles.paso}>¿Qué querés cambiar en los {ids.length} productos?</p>
      <div className={styles.opciones}>
        {CAMPOS_FIJOS.map((c) => (
          <button
            key={c.clave}
            type="button"
            className={campo?.clave === c.clave && !esAtributo ? styles.opcionActiva : styles.opcion}
            onClick={() => elegirCampo(c, false)}
          >
            {c.etiqueta}
          </button>
        ))}
        {definiciones.length > 0 ? (
          <button
            type="button"
            className={esAtributo ? styles.opcionActiva : styles.opcion}
            onClick={() => elegirCampo(null, true)}
          >
            Una característica…
          </button>
        ) : null}
      </div>

      {/* Si eligió «característica», falta decir CUÁL. */}
      {esAtributo ? (
        <Field label="¿Qué característica?">
          <Select
            value={campo?.atributoKey ?? ''}
            onChange={(e) => {
              const d = definiciones.find((x) => x.key === e.target.value)
              setCampo(d ? campoDeAtributo(d) : null)
              setValor('')
              setModoLibre(false)
              setConfirmando(false)
            }}
          >
            <option value="">Elegí una característica…</option>
            {definiciones.map((d) => (
              <option key={d.key} value={d.key}>
                {d.unidad ? `${d.label} (${d.unidad})` : d.label}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      {/* ── Paso 2 · el valor ─────────────────────────────────────────────── */}
      {campo !== null ? (
        <Field
          label={campo.unidad ? `Nuevo valor de ${campo.etiqueta} (${campo.unidad})` : `Nuevo valor de ${campo.etiqueta}`}
        >
          {control()}
        </Field>
      ) : null}

      {/* ── Confirmación ──────────────────────────────────────────────────── */}
      {confirmando && campo !== null ? (
        <Alert tone="warning" role="status" title="Revisá antes de aplicar">
          <p>{describirCambio(campo, valor, ids.length)}</p>
          <p className={styles.aviso}>Este cambio no se deshace con un botón. Mirá que esté bien.</p>
        </Alert>
      ) : null}
    </Dialog>
  )
}
