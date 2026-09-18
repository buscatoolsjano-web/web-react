import { useEffect, useId, useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Input, Select, Textarea } from '@/components/forms/controls'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { ListaDeTextos } from './ListaDeTextos'
import { opcionesDeRubro } from '../lib/rubros'
import {
  validarCliente,
  type DatosCliente,
  type ErrorDeCampo,
} from '../lib/validacion'
import styles from './FormularioCliente.module.css'

export interface FormularioClienteProps {
  valores: DatosCliente
  /** El CUIT con el que se abrió el formulario. Ver `validarCliente`. */
  cuitOriginal?: string | null
  /** La referencia CLI. En el alta la da el servidor y acá se avisa. */
  referencia?: string | null
  guardando: boolean
  errorAlGuardar?: string | null
  etiquetaGuardar: string
  /**
   * Vendedores y tarifas de la empresa (Fase 17 · E1). Vacío o `undefined`
   * esconde esos dos campos: sin opciones, un desplegable vacío no ayuda.
   */
  vendedores?: readonly { id: string; nombre: string }[] | undefined
  tarifas?: readonly { id: string; nombre: string }[] | undefined
  /** `false` deja vendedor y tarifa en sólo lectura: los asigna admin/employee. */
  puedeAsignar?: boolean | undefined
  /** Avisa a la página si hay cambios sin guardar, para el aviso al salir. */
  onCambioSucio?: ((sucio: boolean) => void) | undefined
  onGuardar: (datos: DatosCliente) => void
  onCancelar: () => void
}

/** Las tres monedas que existen en `currencies`. */
const MONEDAS = ['USD', 'ARS', 'EUR'] as const

/**
 * Alta y edición del cliente.
 *
 * Los campos son los que **existen de verdad** en `customers`. No hay
 * «vendedor asignado» ni «lista de precios» editables acá: la columna existe
 * pero el legacy nunca la usó por cliente, y ponerle un desplegable sería
 * invitar a inventar un dato que después nadie sabe de dónde salió.
 *
 * Fase 13 · E4: los mismos campos y la misma validación, agrupados en
 * Identidad, Contacto, Datos comerciales y Notas, con el patrón `Field`.
 * Después de un intento fallido, un aviso arriba dice cuántos campos revisar.
 */
export function FormularioCliente({
  valores,
  cuitOriginal = null,
  referencia = null,
  guardando,
  errorAlGuardar = null,
  etiquetaGuardar,
  vendedores,
  tarifas,
  puedeAsignar = false,
  onCambioSucio,
  onGuardar,
  onCancelar,
}: FormularioClienteProps) {
  const id = useId()
  const [datos, setDatos] = useState<DatosCliente>(valores)
  const [errores, setErrores] = useState<ErrorDeCampo[]>([])
  const [intentado, setIntentado] = useState(false)

  // Qué cambió respecto de lo que se abrió. Sirve para dos cosas: no ofrecer
  // «Guardar» cuando no hay nada que guardar —así el servidor no recibe un
  // guardado vacío— y avisar antes de salir perdiendo lo escrito.
  const sucio = JSON.stringify(datos) !== JSON.stringify(valores)

  // El aviso al padre va en un efecto y no durante el render: cambiar el
  // estado de OTRO componente mientras éste se dibuja es justo lo que React
  // avisa por consola, y con razón.
  useEffect(() => {
    onCambioSucio?.(sucio)
  }, [sucio, onCambioSucio])

  const cambiar = <K extends keyof DatosCliente>(campo: K, valor: DatosCliente[K]) => {
    const siguiente = { ...datos, [campo]: valor }
    setDatos(siguiente)
    // Después del primer intento fallido, la validación acompaña mientras se
    // escribe: si no, hay que apretar Guardar de nuevo para ver si se arregló.
    if (intentado) setErrores(validarCliente(siguiente, cuitOriginal))
  }

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    const encontrados = validarCliente(datos, cuitOriginal)
    setErrores(encontrados)
    setIntentado(true)
    if (encontrados.length === 0) onGuardar(datos)
  }

  const errorDe = (campo: keyof DatosCliente) =>
    errores.find((e) => e.campo === campo)?.mensaje ?? null

  const texto = (
    campo: keyof DatosCliente,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> & { requerido?: boolean } = {},
  ) => {
    const { requerido = false, ...resto } = extra
    return (
      <Field label={etiqueta} required={requerido} error={errorDe(campo) ?? undefined} id={`${id}-${campo}`}>
        <Input
          value={String(datos[campo] ?? '')}
          onChange={(e) => cambiar(campo, e.target.value as DatosCliente[typeof campo])}
          {...resto}
        />
      </Field>
    )
  }

  return (
    <form className={styles.form} onSubmit={enviar} noValidate>
      {intentado && errores.length > 0 ? (
        <Alert tone="danger" role="alert" title={errores.length === 1 ? 'Revisá 1 campo' : `Revisá ${errores.length} campos`}>
          <ul className={styles.resumenErrores}>
            {errores.map((e) => (
              <li key={`${e.campo}-${e.mensaje}`}>{e.mensaje}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Identidad</legend>
        <div className={styles.grilla}>
          {texto('razonSocial', 'Razón social', { requerido: true, autoFocus: true })}
          {texto('nombreComercial', 'Nombre comercial')}
          {texto('cuit', 'CUIT', { inputMode: 'numeric', placeholder: '30-50328441-0' })}
          <Field label="Tipo" id={`${id}-tipo`} error={errorDe('tipo') ?? undefined}>
            <Select value={datos.tipo} onChange={(e) => cambiar('tipo', e.target.value)}>
              <option value="business">Empresa</option>
              <option value="individual">Persona</option>
            </Select>
          </Field>
          <div className={styles.soloLectura}>
            <span className={styles.soloLecturaEtiqueta}>Referencia</span>
            <span className={styles.soloLecturaValor}>{referencia ?? 'La asigna el servidor al guardar'}</span>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Contacto</legend>
        <div className={styles.grilla}>
          {texto('telefono', 'Teléfono', { type: 'tel' })}
        </div>
        <div className={styles.grilla}>
          <ListaDeTextos
            etiqueta="Emails"
            valores={datos.emails}
            tipo="email"
            placeholder="compras@empresa.com"
            ayuda="Son direcciones de la empresa, no personas. Los contactos van en su pestaña."
            error={errorDe('emails')}
            onCambiar={(v) => cambiar('emails', v)}
          />
          <ListaDeTextos
            etiqueta="Dominios"
            valores={datos.dominios}
            placeholder="empresa.com"
            ayuda="Sirven para reconocer al cliente por el mail desde el que escribe."
            onCambiar={(v) => cambiar('dominios', v)}
          />
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Datos comerciales</legend>
        <div className={styles.grilla}>
          <Field label="Rubro" id={`${id}-rubro`} error={errorDe('rubro') ?? undefined}>
            {/* Un `input` con `datalist` y no un `select`: los cuatro rubros del
                legacy son una sugerencia, no una lista cerrada. `industry` es
                texto libre y no hay tabla de rubros. */}
            <Input list={`${id}-rubros`} value={datos.rubro} onChange={(e) => cambiar('rubro', e.target.value)} />
          </Field>
          <datalist id={`${id}-rubros`}>
            {opcionesDeRubro(valores.rubro).map((r) => (
              <option key={r} value={r} />
            ))}
          </datalist>
          {texto('condicionDePago', 'Condición de pago')}
          {/* Fase 17 · E1: el vendedor y la tarifa del cliente se editan acá.
              Todavía NO sugieren nada al crear documentos —eso es E2—: por
              ahora son la ficha del cliente, no una regla de Ventas. */}
          {puedeAsignar && (vendedores?.length ?? 0) > 0 ? (
            <Field label="Vendedor asignado" id={`${id}-vendedor`} optional>
              <Select
                value={datos.vendedorId}
                onChange={(e) => cambiar('vendedorId', e.target.value)}
              >
                <option value="">Sin asignar</option>
                {(vendedores ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {puedeAsignar && (tarifas?.length ?? 0) > 0 ? (
            <Field
              label="Tarifa por defecto"
              id={`${id}-tarifa`}
              optional
              help="Queda registrada en el cliente. Todavía no cambia los precios de los documentos."
            >
              <Select value={datos.tarifaId} onChange={(e) => cambiar('tarifaId', e.target.value)}>
                <option value="">Sin tarifa</option>
                {(tarifas ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Moneda por defecto" id={`${id}-moneda`}>
            <Select value={datos.monedaPorDefecto} onChange={(e) => cambiar('monedaPorDefecto', e.target.value)}>
              <option value="">Sin definir</option>
              {MONEDAS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </fieldset>

      <fieldset className={styles.grupo}>
        <legend className={styles.leyenda}>Notas</legend>
        <Field label="Notas" hideLabel id={`${id}-notas`} error={errorDe('notas') ?? undefined}>
          <Textarea rows={3} value={datos.notas} onChange={(e) => cambiar('notas', e.target.value)} />
        </Field>
      </fieldset>

      {errorAlGuardar ? (
        <Alert tone="danger" role="alert" title="No se pudo guardar">
          <p>{errorAlGuardar}</p>
        </Alert>
      ) : null}

      <div className={styles.acciones}>
        <Button type="submit" variant="primary" loading={guardando} disabled={!sucio || guardando}>
          {guardando ? 'Guardando…' : etiquetaGuardar}
        </Button>
        <Button variant="ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
      </div>
    </form>
  )
}
