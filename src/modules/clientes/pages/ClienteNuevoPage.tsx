import { useCallback, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocSection } from '@/components/document/DocSection'
import doc from '@/components/document/Document.module.css'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Alert } from '@/components/feedback/Alert'
import { Field } from '@/components/forms/Field'
import { Checkbox, Input, Select } from '@/components/forms/controls'
import { LinkButton } from '@/components/ui/LinkButton'
import { useDebounce } from '@/hooks/useDebounce'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { FormularioCliente } from '../components/FormularioCliente'
import { PanelSimilares } from '../components/PanelSimilares'
import { permisosDe } from '../lib/permisos'
import {
  CLIENTE_VACIO,
  CONTACTO_VACIO,
  DIRECCION_VACIA,
  TIPOS_DE_DIRECCION,
  validarContacto,
  validarDireccion,
  type DatosCliente,
  type DatosContacto,
  type DatosDireccion,
} from '../lib/validacion'
import { useCrearCliente } from '../hooks/useEdicionClientes'
import { useClientesSimilares, useOpcionesComerciales } from '../hooks/useClientes'
import styles from './ClienteNuevoPage.module.css'

/**
 * Alta de cliente (Fase 17 · E5).
 *
 * Tres cosas que antes no estaban:
 *
 * 1. **Es una transacción.** El cliente, su primer contacto y su primera
 *    dirección entran juntos o no entra nada. Antes eran dos viajes y la
 *    referencia `CLI00001` se perdía si el segundo fallaba.
 * 2. **Avisa si el cliente ya existe** mientras se escribe, con el CUIT, el
 *    email, el teléfono y el nombre. Propone: no fusiona ni bloquea, salvo el
 *    CUIT, que lo bloquea la base porque dos clientes no tienen el mismo.
 * 3. **El contacto y la dirección son opcionales.** Se puede crear sólo el
 *    cliente, o con contacto, o con dirección, o con los tres.
 *
 * La referencia sigue siendo del servidor: `nextClienteRef` del legacy hacía
 * `MAX+1` sobre la lista que tenía en memoria y dos personas dando de alta a
 * la vez se pisaban el número.
 */
export function ClienteNuevoPage() {
  const { activa } = useEmpresa()
  const permisos = permisosDe(activa)
  const crear = useCrearCliente()
  const navegar = useNavigate()
  const id = useId()
  const volver = { to: '/clientes', label: 'Clientes' }

  // Los defaults comerciales se pueden dejar puestos desde el alta: son los
  // que E2 va a sugerir al armar el primer documento de este cliente.
  const opciones = useOpcionesComerciales(permisos.editarContactos)

  const [conContacto, setConContacto] = useState(false)
  const [contacto, setContacto] = useState<DatosContacto>(CONTACTO_VACIO)
  const [conDireccion, setConDireccion] = useState(false)
  const [direccion, setDireccion] = useState<DatosDireccion>(DIRECCION_VACIA)
  const [errores, setErrores] = useState<string[]>([])

  // Lo que hay escrito en el formulario del cliente, para buscar parecidos.
  const [datos, setDatos] = useState<DatosCliente>(CLIENTE_VACIO)
  const alCambiarDatos = useCallback((d: DatosCliente) => setDatos(d), [])

  // La búsqueda espera a que dejen de escribir: una consulta por tecla sobre
  // 1.010 clientes no le sirve a nadie.
  const entrada = useDebounce(
    JSON.stringify({
      nombre: datos.razonSocial || datos.nombreComercial,
      cuit: datos.cuit,
      email: datos.emails[0] ?? '',
      telefono: datos.telefono,
    }),
    400,
  )
  const similares = useClientesSimilares(JSON.parse(entrada) as Record<string, string>)
  const candidatos = similares.data ?? []
  const mismoCuit = candidatos.some((c) => c.fuerza === 'fuerte')

  if (!permisos.crearCliente) {
    return (
      <div className={doc.pagina}>
        <PageHeader title="Nuevo cliente" back={volver} />
        <EmptyState
          icon="users"
          title="Tu rol no puede dar de alta clientes"
          description="El alta es de administradores, empleados y vendedores."
          action={<LinkButton to="/clientes">Volver al listado</LinkButton>}
        />
      </div>
    )
  }

  const guardar = (valores: DatosCliente) => {
    // El contacto y la dirección se validan acá porque viven en esta pantalla;
    // el cliente ya lo validó el formulario. El servidor los vuelve a validar
    // igual: esto es para no hacer el viaje.
    const problemas = [
      ...(conContacto ? validarContacto(contacto) : []),
      ...(conDireccion ? validarDireccion(direccion) : []),
    ]
    setErrores(problemas)
    if (problemas.length > 0) return

    crear.mutate(
      {
        datos: valores,
        contacto: conContacto ? contacto : null,
        direccion: conDireccion ? direccion : null,
      },
      { onSuccess: ({ id: nuevo }) => void navegar(`/clientes/${nuevo}`) },
    )
  }

  const campoContacto = (
    clave: keyof DatosContacto,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> & { requerido?: boolean } = {},
  ) => {
    const { requerido = false, ...resto } = extra
    return (
      <Field label={etiqueta} required={requerido} id={`${id}-c-${clave}`}>
        <Input
          value={String(contacto[clave] ?? '')}
          onChange={(e) => setContacto({ ...contacto, [clave]: e.target.value })}
          {...resto}
        />
      </Field>
    )
  }

  const campoDireccion = (
    clave: keyof DatosDireccion,
    etiqueta: string,
    extra: React.InputHTMLAttributes<HTMLInputElement> & { requerido?: boolean } = {},
  ) => {
    const { requerido = false, ...resto } = extra
    return (
      <Field label={etiqueta} required={requerido} id={`${id}-d-${clave}`}>
        <Input
          value={String(direccion[clave] ?? '')}
          onChange={(e) => setDireccion({ ...direccion, [clave]: e.target.value })}
          {...resto}
        />
      </Field>
    )
  }

  return (
    <div className={`${doc.pagina} ${styles.pagina}`}>
      <PageHeader
        back={volver}
        title="Nuevo cliente"
        subtitle="El cliente, su primer contacto y su primera dirección se guardan juntos."
      />

      <DocSection>
        <FormularioCliente
          valores={CLIENTE_VACIO}
          guardando={crear.isPending}
          errorAlGuardar={crear.error?.message ?? null}
          etiquetaGuardar="Crear cliente"
          vendedores={opciones.vendedores}
          tarifas={opciones.tarifas}
          puedeAsignar={permisos.editarContactos}
          onCambioDatos={alCambiarDatos}
          bloqueado={mismoCuit}
          motivoBloqueo={
            mismoCuit ? (
              <p>
                Ya hay un cliente con ese CUIT en esta empresa. Abrilo desde la lista de arriba, o
                corregí el CUIT si te equivocaste al escribirlo.
              </p>
            ) : undefined
          }
          extra={
            <>
              <PanelSimilares candidatos={candidatos} buscando={similares.isFetching} />

              <fieldset className={styles.grupo}>
                <legend className={styles.leyenda}>Primer contacto</legend>
                <Checkbox
                  label="Cargar un contacto ahora"
                  help="Queda como contacto principal del cliente. También se puede agregar después, desde la ficha."
                  checked={conContacto}
                  onChange={(e) => setConContacto(e.target.checked)}
                />
                {conContacto ? (
                  <div className={styles.grilla}>
                    {campoContacto('nombre', 'Nombre', { requerido: true })}
                    {campoContacto('cargo', 'Cargo')}
                    {campoContacto('email', 'Email', { type: 'email' })}
                    {campoContacto('telefono', 'Teléfono', { type: 'tel' })}
                  </div>
                ) : null}
              </fieldset>

              <fieldset className={styles.grupo}>
                <legend className={styles.leyenda}>Primera dirección</legend>
                <Checkbox
                  label="Cargar una dirección ahora"
                  help="Queda como principal de su tipo. La de entrega es la que después propone el pedido."
                  checked={conDireccion}
                  onChange={(e) => setConDireccion(e.target.checked)}
                />
                {conDireccion ? (
                  <div className={styles.grilla}>
                    <Field label="Tipo" id={`${id}-d-tipo`}>
                      <Select
                        value={direccion.tipo}
                        onChange={(e) => setDireccion({ ...direccion, tipo: e.target.value })}
                      >
                        {TIPOS_DE_DIRECCION.map((t) => (
                          <option key={t.valor} value={t.valor}>
                            {t.etiqueta}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {campoDireccion('calle', 'Calle y número', { requerido: true })}
                    {campoDireccion('ciudad', 'Ciudad')}
                    {campoDireccion('provincia', 'Provincia')}
                    {campoDireccion('codigoPostal', 'Código postal')}
                    {campoDireccion('pais', 'País', { placeholder: 'AR', maxLength: 2 })}
                  </div>
                ) : null}
              </fieldset>

              {errores.length > 0 ? (
                <Alert tone="danger" role="alert" title="Revisá lo que cargaste">
                  <ul className={styles.errores}>
                    {errores.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                </Alert>
              ) : null}
            </>
          }
          onGuardar={guardar}
          onCancelar={() => void navegar('/clientes')}
        />
      </DocSection>
    </div>
  )
}
