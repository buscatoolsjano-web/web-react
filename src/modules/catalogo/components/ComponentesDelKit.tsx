import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/forms/controls'
import { Icon } from '@/components/icons/Icon'
import { useEmpresa } from '@/features/empresa/useEmpresa'
import { buscarComponentes, type CandidatoComponente } from '../services/productos'
import { filaVacia, type ComponenteElegido } from '../lib/kit'
import styles from './ComponentesDelKit.module.css'

export interface ComponentesDelKitProps {
  componentes: ComponenteElegido[]
  onCambiar: (c: ComponenteElegido[]) => void
}

/**
 * La receta de un kit: qué productos lo componen y cuántos de cada uno.
 *
 * El kit NO tiene stock propio. Lo que se puede armar sale del cuello de
 * botella de estas filas, y venderlo descuenta estos productos. Por eso la
 * cantidad es de la RECETA («cuántas patas lleva una mesa») y no un stock.
 */
export function ComponentesDelKit({ componentes, onCambiar }: ComponentesDelKitProps) {
  const cambiarFila = (fila: string, cambio: Partial<ComponenteElegido>) =>
    onCambiar(componentes.map((c) => (c.fila === fila ? { ...c, ...cambio } : c)))

  const quitar = (fila: string) => onCambiar(componentes.filter((c) => c.fila !== fila))

  const yaElegidos = new Set(componentes.map((c) => c.producto?.id).filter(Boolean) as string[])

  return (
    <div className={styles.receta}>
      <p className={styles.explicacion}>
        El kit no tiene stock propio: se calcula con el componente que primero se acaba. Con 4 patas
        y 1 tablón por mesa, 8 patas y 3 tablones son 2 mesas.
      </p>

      {componentes.length === 0 ? (
        <p className={styles.vacio}>Todavía no agregaste ningún componente.</p>
      ) : (
        <ul className={styles.lista}>
          {componentes.map((c) => (
            <li key={c.fila} className={styles.fila}>
              <FilaComponente
                componente={c}
                yaElegidos={yaElegidos}
                onElegir={(p) => cambiarFila(c.fila, { producto: p })}
                onCantidad={(v) => cambiarFila(c.fila, { cantidad: v })}
                onQuitar={() => quitar(c.fila)}
              />
            </li>
          ))}
        </ul>
      )}

      <Button
        variant="secondary"
        size="sm"
        icon={<Icon name="plus" size={16} />}
        onClick={() => onCambiar([...componentes, filaVacia()])}
      >
        Agregar componente
      </Button>
    </div>
  )
}

interface FilaComponenteProps {
  componente: ComponenteElegido
  yaElegidos: Set<string>
  onElegir: (p: CandidatoComponente | null) => void
  onCantidad: (v: string) => void
  onQuitar: () => void
}

function FilaComponente({ componente, yaElegidos, onElegir, onCantidad, onQuitar }: FilaComponenteProps) {
  const { activa } = useEmpresa()
  const companyId = activa?.companyId ?? null
  const [texto, setTexto] = useState('')
  const [consulta, setConsulta] = useState('')

  // Se espera a que pare de tipear: sin esto, «balanceador» son once consultas.
  useEffect(() => {
    const id = setTimeout(() => setConsulta(texto), 300)
    return () => clearTimeout(id)
  }, [texto])

  const resultados = useQuery({
    queryKey: ['catalogo', companyId, 'componentes', consulta],
    queryFn: () => buscarComponentes(companyId!, consulta),
    enabled: companyId !== null && consulta.trim().length >= 2 && componente.producto === null,
  })

  if (componente.producto !== null) {
    return (
      <>
        <div className={styles.elegido}>
          <strong>{componente.producto.sku}</strong>
          <span>{componente.producto.nombre}</span>
        </div>
        <Field label="Cantidad" required>
          <Input
            value={componente.cantidad}
            inputMode="decimal"
            className={styles.cantidad}
            onChange={(e) => onCantidad(e.target.value)}
          />
        </Field>
        <Button variant="ghost" size="sm" onClick={() => onElegir(null)}>
          Cambiar
        </Button>
        <Button variant="ghost" size="sm" onClick={onQuitar}>
          Quitar
        </Button>
      </>
    )
  }

  return (
    <div className={styles.buscador}>
      <Field label="Buscar producto" help="Por referencia o por nombre. Los kits no se pueden anidar.">
        <Input
          value={texto}
          autoComplete="off"
          placeholder="SP.2520, balanceador…"
          onChange={(e) => setTexto(e.target.value)}
        />
      </Field>

      {resultados.isFetching ? <p className={styles.vacio}>Buscando…</p> : null}

      {resultados.data !== undefined && resultados.data.length === 0 && !resultados.isFetching ? (
        <p className={styles.vacio}>Ningún producto coincide.</p>
      ) : null}

      {resultados.data !== undefined && resultados.data.length > 0 ? (
        <ul className={styles.resultados}>
          {resultados.data.map((p) => {
            // Un componente repetido choca con el índice único de la base: se
            // avisa acá en vez de dejar que falle al guardar.
            const repetido = yaElegidos.has(p.id)
            return (
              <li key={p.id}>
                <button type="button" disabled={repetido} onClick={() => onElegir(p)}>
                  <strong>{p.sku}</strong>
                  <span>{p.nombre}</span>
                  {repetido ? <em>ya está en el kit</em> : null}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}

      <Button variant="ghost" size="sm" onClick={onQuitar}>
        Quitar esta línea
      </Button>
    </div>
  )
}
