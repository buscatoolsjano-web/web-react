// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SelectorFormaDePago } from './SelectorFormaDePago'
import type { FormaDePago } from '@/modules/configuracion/services/maestros'

const opcion = (nombre: string, activa = true): FormaDePago => ({
  id: nombre,
  nombre,
  activa,
  orden: 10,
  usos: 0,
})

const OPCIONES = [opcion('Pago por adelantado'), opcion('30 días'), opcion('Vieja', false)]

const desplegable = () => screen.getByRole('combobox')
const opciones = () =>
  Array.from(desplegable().querySelectorAll('option')).map((o) => o.textContent ?? '')

describe('el selector de forma de pago', () => {
  it('ofrece las activas y la opción de no especificar', () => {
    render(<SelectorFormaDePago valor="" opciones={OPCIONES} onCambiar={vi.fn()} />)
    expect(opciones()).toEqual(['Sin especificar', 'Pago por adelantado', '30 días'])
  })

  /* Una opción desactivada se deja de ofrecer: para eso se desactiva. */
  it('no ofrece las desactivadas', () => {
    render(<SelectorFormaDePago valor="" opciones={OPCIONES} onCambiar={vi.fn()} />)
    expect(opciones()).not.toContain('Vieja')
  })

  it('elegir una avisa con el TEXTO, no con un id', () => {
    const onCambiar = vi.fn()
    render(<SelectorFormaDePago valor="" opciones={OPCIONES} onCambiar={onCambiar} />)
    fireEvent.change(desplegable(), { target: { value: '30 días' } })
    expect(onCambiar).toHaveBeenCalledWith('30 días')
  })

  /*
   * ── EL CASO QUE NO SE PUEDE PERDER ────────────────────────────────────────
   *
   * El documento guarda el texto, no un id, así que una cotización vieja puede
   * tener algo que ya no está en la lista: se borró la opción, o se escribió a
   * mano antes de que esto existiera. Si el desplegable no lo incluyera, abrir
   * esa cotización mostraría «Sin especificar» y guardarla BORRARÍA en silencio
   * lo que decía el documento.
   */
  it('un valor que ya no está en la lista se muestra igual, marcado', () => {
    render(
      <SelectorFormaDePago valor="30 DIAS F/F con ECHEQ" opciones={OPCIONES} onCambiar={vi.fn()} />,
    )
    expect(opciones()).toContain('30 DIAS F/F con ECHEQ (fuera de la lista)')
    expect((desplegable() as HTMLSelectElement).value).toBe('30 DIAS F/F con ECHEQ')
  })

  it('y una desactivada que el documento ya tenía tampoco se pierde', () => {
    render(<SelectorFormaDePago valor="Vieja" opciones={OPCIONES} onCambiar={vi.fn()} />)
    expect((desplegable() as HTMLSelectElement).value).toBe('Vieja')
  })

  /* Sin `onAgregar` la pantalla no puede escribir en el catálogo. */
  it('sin permiso de agregar, no ofrece agregar', () => {
    render(<SelectorFormaDePago valor="" opciones={OPCIONES} onCambiar={vi.fn()} />)
    expect(opciones().some((o) => o.includes('Agregar'))).toBe(false)
  })

  describe('agregar una opción nueva', () => {
    function conAlta(onAgregar: (n: string) => Promise<string>) {
      const onCambiar = vi.fn()
      render(
        <SelectorFormaDePago
          valor=""
          opciones={OPCIONES}
          onCambiar={onCambiar}
          onAgregar={onAgregar}
        />,
      )
      fireEvent.change(desplegable(), { target: { value: '\u0000agregar' } })
      return onCambiar
    }

    it('guarda y selecciona lo que devolvió el servidor, no lo que se tipeó', async () => {
      // El servidor normaliza: «  90  días » queda «90 días». Si se seleccionara
      // el texto tipeado, la opción recién creada aparecería como «fuera de la
      // lista» en su propio formulario.
      const onAgregar = vi.fn(async () => Promise.resolve('90 días'))
      const onCambiar = conAlta(onAgregar)

      fireEvent.change(screen.getByRole('textbox'), { target: { value: '  90  días ' } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

      await waitFor(() => expect(onAgregar).toHaveBeenCalledWith('90  días'))
      await waitFor(() => expect(onCambiar).toHaveBeenCalledWith('90 días'))
    })

    it('elegir «agregar» no cambia el valor del documento', () => {
      const onCambiar = conAlta(async () => Promise.resolve('x'))
      expect(onCambiar).not.toHaveBeenCalled()
    })

    it('con el campo vacío no se puede guardar', () => {
      conAlta(async () => Promise.resolve('x'))
      expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    })

    it('cancelar vuelve al desplegable sin tocar nada', () => {
      const onCambiar = conAlta(async () => Promise.resolve('x'))
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
      expect(desplegable()).toBeInTheDocument()
      expect(onCambiar).not.toHaveBeenCalled()
    })

    /* El error llega traducido; mostrarlo crudo sería mostrar un código. */
    it('si falla, lo dice y no cierra el campo', async () => {
      conAlta(async () => Promise.reject(new Error('Ya existe otra con ese nombre.')))
      fireEvent.change(screen.getByRole('textbox'), { target: { value: '30 días' } })
      fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

      expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe otra con ese nombre.')
      expect(screen.getByRole('textbox')).toBeInTheDocument()
    })

    /*
     * Enter guarda. Importa que NO envíe el formulario de la cotización: este
     * campo vive adentro de él, y un Enter que lo envíe guardaría el documento
     * a medio editar.
     */
    it('Enter guarda y no envía el formulario de alrededor', async () => {
      const onAgregar = vi.fn(async () => Promise.resolve('90 días'))
      const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault())
      render(
        <form onSubmit={onSubmit}>
          <SelectorFormaDePago valor="" opciones={OPCIONES} onCambiar={vi.fn()} onAgregar={onAgregar} />
        </form>,
      )
      const combos = screen.getAllByRole('combobox')
      fireEvent.change(combos[combos.length - 1]!, { target: { value: '\u0000agregar' } })
      const campos = screen.getAllByRole('textbox')
      const campo = campos[campos.length - 1]!
      fireEvent.change(campo, { target: { value: '90 días' } })
      fireEvent.keyDown(campo, { key: 'Enter' })

      await waitFor(() => expect(onAgregar).toHaveBeenCalled())
      expect(onSubmit).not.toHaveBeenCalled()
    })
  })
})
