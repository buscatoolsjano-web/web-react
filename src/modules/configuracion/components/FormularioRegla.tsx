import { useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Input, Select, Switch } from '@/components/forms/controls'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/icons/Icon'
import { ESTADOS_TRABAJO, type EstadoTrabajo } from '@/modules/emails/types'
import {
  CAMPOS_REGLA,
  CONDICION_NUEVA,
  ETIQUETA_CAMPO,
  ETIQUETA_ESTADO_ACCION,
  ETIQUETA_OPERADOR,
  OPERADORES_REGLA,
  esCondicionCliente,
  problemasDeRegla,
  type Accion,
  type Condicion,
  type OperadorRegla,
  type ReglaCorreo,
} from '../lib/reglasCorreo'
import styles from './ReglasCorreo.module.css'

export interface FormularioReglaProps {
  inicial: ReglaCorreo | null
  etiquetas: readonly { id: string; nombre: string }[]
  personas: readonly { id: string; nombre: string }[]
  onCrearEtiqueta: (nombre: string) => Promise<{ id: string; nombre: string }>
  onGuardar: (r: Omit<ReglaCorreo, 'id'> & { id: string | null }) => void
  guardando: boolean
  error: string | null
}

/**
 * El formulario de una regla (Fase 70 · E2).
 *
 * SE LEE COMO UNA FRASE: «Si … y … , entonces … y …». Las dos mitades están
 * separadas y rotuladas con esas palabras, porque es la única forma de que
 * alguien que no armó la regla entienda qué hace sin desarmarla.
 *
 * Cada condición y cada acción es un renglón con su botón de sacar. Nada de
 * «agregar hasta tres condiciones numeradas»: se agregan y se sacan, y el
 * orden no importa —salvo en las acciones, donde la primera que asigna gana—.
 */
export function FormularioRegla({
  inicial,
  etiquetas,
  personas,
  onCrearEtiqueta,
  onGuardar,
  guardando,
  error,
}: FormularioReglaProps) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [activa, setActiva] = useState(inicial?.activa ?? true)
  const [condiciones, setCondiciones] = useState<Condicion[]>(
    inicial?.condiciones.length ? [...inicial.condiciones] : [{ ...CONDICION_NUEVA }],
  )
  const [acciones, setAcciones] = useState<Accion[]>(
    inicial?.acciones.length ? [...inicial.acciones] : [{ tipo: 'etiquetar', labelId: '' }],
  )
  const [etiquetaNueva, setEtiquetaNueva] = useState('')
  const [tocado, setTocado] = useState(false)

  const problemas = problemasDeRegla({ nombre, condiciones, acciones })

  const cambiarCondicion = (i: number, c: Condicion) =>
    setCondiciones((xs) => xs.map((x, k) => (k === i ? c : x)))
  const cambiarAccion = (i: number, a: Accion) => setAcciones((xs) => xs.map((x, k) => (k === i ? a : x)))

  /* Cambiar el campo a «es cliente» cambia la FORMA de la condición: deja de
     tener texto y pasa a ser un sí o un no. Se arma de cero en vez de arrastrar
     un `valor` de texto que después nadie sabe de dónde salió. */
  const cambiarCampo = (i: number, campo: string) =>
    cambiarCondicion(
      i,
      campo === 'es_cliente'
        ? { campo: 'es_cliente', valor: true }
        : { campo: campo as 'de' | 'para' | 'asunto' | 'texto', op: 'contiene', valor: '' },
    )

  const agregarEtiqueta = async () => {
    const n = etiquetaNueva.trim()
    if (n === '') return
    const creada = await onCrearEtiqueta(n)
    setEtiquetaNueva('')
    /* Se enchufa en la primera acción de etiquetar que esté vacía: el motivo
       de crearla era justamente usarla acá. */
    setAcciones((xs) => {
      const i = xs.findIndex((a) => a.tipo === 'etiquetar' && a.labelId === '')
      return i === -1
        ? [...xs, { tipo: 'etiquetar', labelId: creada.id }]
        : xs.map((a, k) => (k === i ? { tipo: 'etiquetar', labelId: creada.id } : a))
    })
  }

  return (
    <form
      className={styles.formulario}
      onSubmit={(e) => {
        e.preventDefault()
        setTocado(true)
        if (problemas.length > 0) return
        onGuardar({ id: inicial?.id ?? null, nombre: nombre.trim(), activa, orden: inicial?.orden ?? 100, condiciones, acciones })
      }}
    >
      <Field label="Nombre de la regla" required>
        <Input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          placeholder="Avisos de STEL"
          maxLength={60}
          autoFocus
        />
      </Field>

      <fieldset className={styles.mitad}>
        <legend className={styles.legend}>Si se cumple todo esto</legend>
        {condiciones.map((c, i) => (
          <div key={i} className={styles.renglon}>
            <Select
              aria-label={`Qué se mira en la condición ${i + 1}`}
              value={c.campo}
              onChange={(e) => cambiarCampo(i, e.target.value)}
            >
              {CAMPOS_REGLA.map((x) => (
                <option key={x} value={x}>
                  {ETIQUETA_CAMPO[x]}
                </option>
              ))}
            </Select>

            {esCondicionCliente(c) ? (
              <Select
                aria-label={`Sí o no en la condición ${i + 1}`}
                value={c.valor ? 'si' : 'no'}
                onChange={(e) => cambiarCondicion(i, { campo: 'es_cliente', valor: e.target.value === 'si' })}
              >
                <option value="si">Sí</option>
                <option value="no">No</option>
              </Select>
            ) : (
              <>
                <Select
                  aria-label={`Cómo se compara en la condición ${i + 1}`}
                  value={c.op}
                  onChange={(e) => cambiarCondicion(i, { ...c, op: e.target.value as OperadorRegla })}
                >
                  {OPERADORES_REGLA.map((o) => (
                    <option key={o} value={o}>
                      {ETIQUETA_OPERADOR[o]}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Texto de la condición ${i + 1}`}
                  value={c.valor}
                  onChange={(e) => cambiarCondicion(i, { ...c, valor: e.target.value })}
                  placeholder="stelorder.com"
                />
              </>
            )}

            <button
              type="button"
              className={styles.sacar}
              aria-label={`Sacar la condición ${i + 1}`}
              disabled={condiciones.length === 1}
              onClick={() => setCondiciones((xs) => xs.filter((_, k) => k !== i))}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Icon name="plus" size={16} />}
          onClick={() => setCondiciones((xs) => [...xs, { ...CONDICION_NUEVA }])}
        >
          Otra condición
        </Button>
      </fieldset>

      <fieldset className={styles.mitad}>
        <legend className={styles.legend}>Entonces hacé esto</legend>
        {acciones.map((a, i) => (
          <div key={i} className={styles.renglon}>
            <Select
              aria-label={`Qué hace la acción ${i + 1}`}
              value={a.tipo}
              onChange={(e) => {
                const t = e.target.value
                cambiarAccion(
                  i,
                  t === 'etiquetar'
                    ? { tipo: 'etiquetar', labelId: '' }
                    : t === 'asignar'
                      ? { tipo: 'asignar', userId: '' }
                      : t === 'estado'
                        ? { tipo: 'estado', valor: 'resuelto' }
                        : { tipo: 'sacar_de_bandeja' },
                )
              }}
            >
              <option value="etiquetar">Ponerle una etiqueta</option>
              <option value="asignar">Asignárselo a</option>
              <option value="estado">Cambiarle el estado</option>
              <option value="sacar_de_bandeja">Sacarlo de la bandeja</option>
            </Select>

            {a.tipo === 'etiquetar' ? (
              <Select
                aria-label={`Etiqueta de la acción ${i + 1}`}
                value={a.labelId}
                onChange={(e) => cambiarAccion(i, { tipo: 'etiquetar', labelId: e.target.value })}
              >
                <option value="">Elegí una…</option>
                {etiquetas.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.nombre}
                  </option>
                ))}
              </Select>
            ) : null}

            {a.tipo === 'asignar' ? (
              <Select
                aria-label={`Persona de la acción ${i + 1}`}
                value={a.userId}
                onChange={(e) => cambiarAccion(i, { tipo: 'asignar', userId: e.target.value })}
              >
                <option value="">Elegí a alguien…</option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Select>
            ) : null}

            {a.tipo === 'estado' ? (
              <Select
                aria-label={`Estado de la acción ${i + 1}`}
                value={a.valor}
                onChange={(e) => cambiarAccion(i, { tipo: 'estado', valor: e.target.value as EstadoTrabajo })}
              >
                {ESTADOS_TRABAJO.map((x) => (
                  <option key={x} value={x}>
                    {ETIQUETA_ESTADO_ACCION[x]}
                  </option>
                ))}
              </Select>
            ) : null}

            <button
              type="button"
              className={styles.sacar}
              aria-label={`Sacar la acción ${i + 1}`}
              disabled={acciones.length === 1}
              onClick={() => setAcciones((xs) => xs.filter((_, k) => k !== i))}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          icon={<Icon name="plus" size={16} />}
          onClick={() => setAcciones((xs) => [...xs, { tipo: 'etiquetar', labelId: '' }])}
        >
          Otra acción
        </Button>

        {/* Crear la etiqueta acá mismo: la regla suele ser su primer uso, y
            mandar a alguien a otra pantalla —y volver— pierde el formulario. */}
        <div className={styles.renglon}>
          <Input
            aria-label="Nombre de una etiqueta nueva"
            value={etiquetaNueva}
            onChange={(e) => setEtiquetaNueva(e.target.value)}
            placeholder="…o creá una etiqueta nueva"
          />
          <Button type="button" variant="secondary" size="sm" disabled={etiquetaNueva.trim() === ''} onClick={() => void agregarEtiqueta()}>
            Crear
          </Button>
        </div>
      </fieldset>

      <Switch
        label="La regla está activa"
        checked={activa}
        onChange={(e) => setActiva(e.target.checked)}
      />

      {/* Los problemas se muestran recién cuando intentó guardar: marcarle
          errores a alguien que todavía está escribiendo el primer campo es
          regañarlo por no haber terminado. */}
      {tocado && problemas.length > 0 ? (
        <ul className={styles.problemas}>
          {problemas.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {error ? <p className={styles.error}>{error}</p> : null}

      <div className={styles.pie}>
        <Button type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar la regla'}
        </Button>
      </div>
    </form>
  )
}
