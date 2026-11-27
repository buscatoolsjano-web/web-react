import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/feedback/EmptyState'
import { Alert } from '@/components/feedback/Alert'
import { Button } from '@/components/ui/Button'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { useAdminGeneral } from '@/features/empresa/useAdminGeneral'
import { MODULOS, PRESET_DISTRIBUIDOR } from '@/features/empresa/modulos'
import { guardarModulosEmpresa } from '@/services/empresa/modulos'
import styles from './ModulosPage.module.css'

/**
 * Qué herramientas tiene la empresa activa (módulos por empresa, 2026-11-27).
 *
 * Sólo para administradores generales: el admin de un distribuidor administra
 * su empresa pero no decide qué módulos tiene. La base lo vuelve a exigir en
 * `config_modulos_empresa`, y es la base la que impide USAR un módulo
 * deshabilitado (no sólo esta pantalla y el menú).
 *
 * «Todos» guarda `null`: la empresa recibe también los módulos que se agreguen
 * en el futuro. Una lista fija sólo esos.
 */
export function ModulosPage() {
  const { activa, recargar } = useEmpresa()
  const esGeneral = useAdminGeneral()
  // El estado del formulario arranca de la empresa activa y se reinicia al
  // cambiar de empresa: se guarda junto con el id del que salió.
  const [borrador, setBorrador] = useState<{ companyId: string | null; todos: boolean; elegidos: string[] }>({
    companyId: null,
    todos: true,
    elegidos: [],
  })
  const companyId = activa?.companyId ?? null
  const actual =
    borrador.companyId === companyId
      ? borrador
      : { companyId, todos: activa?.modulos == null, elegidos: [...(activa?.modulos ?? [])] }

  const guardar = useMutation({
    mutationFn: () => guardarModulosEmpresa(companyId!, actual.todos ? null : actual.elegidos),
    onSuccess: () => recargar(),
  })

  if (!esGeneral) {
    return (
      <EmptyState
        icon="settings"
        title="Sin acceso a Módulos"
        description="Los módulos de cada empresa los decide un administrador general."
      />
    )
  }

  const alternar = (clave: string) => {
    const elegidos = actual.elegidos.includes(clave) ? actual.elegidos.filter((c) => c !== clave) : [...actual.elegidos, clave]
    setBorrador({ ...actual, todos: false, elegidos })
  }

  return (
    <>
      <PageHeader
        title="Módulos"
        subtitle={`Qué herramientas tiene ${activa?.companyName ?? 'la empresa'}. Inicio, catálogo, clientes, cotizaciones y configuración están siempre.`}
      />
      <div className={styles.cuerpo}>
        <label className={styles.todos}>
          <input
            type="checkbox"
            checked={actual.todos}
            onChange={(e) => setBorrador({ ...actual, todos: e.target.checked })}
          />
          <span>
            <strong>Todos los módulos</strong>
            <span className={styles.ayuda}>Como Buscatools: incluye también los que se agreguen más adelante.</span>
          </span>
        </label>

        <fieldset className={styles.lista} disabled={actual.todos}>
          <legend className={styles.leyenda}>Módulos habilitados</legend>
          {MODULOS.map((m) => (
            <label key={m.clave} className={styles.modulo}>
              <input
                type="checkbox"
                checked={actual.todos || actual.elegidos.includes(m.clave)}
                onChange={() => alternar(m.clave)}
              />
              <span>
                <strong>{m.etiqueta}</strong>
                <span className={styles.ayuda}>{m.descripcion}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className={styles.acciones}>
          <Button
            variant="secondary"
            onClick={() => setBorrador({ companyId, todos: false, elegidos: [...PRESET_DISTRIBUIDOR] })}
          >
            Usar los de distribuidor
          </Button>
          <Button loading={guardar.isPending} onClick={() => guardar.mutate()}>
            Guardar
          </Button>
        </div>

        {guardar.isError ? (
          <Alert tone="danger" title="No se guardó">
            {guardar.error.message}
          </Alert>
        ) : null}
        {guardar.isSuccess ? <Alert tone="success" role="status" title="Módulos guardados." /> : null}
      </div>
    </>
  )
}
