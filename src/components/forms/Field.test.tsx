// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Field } from './Field'
import { Checkbox, Input, Select, Switch, Textarea } from './controls'

describe('Field + controles', () => {
  it('label asociado, ayuda y error en aria-describedby, aria-invalid', () => {
    render(
      <Field label="Razón social" help="Como figura en el CUIT." error="Escribí un nombre." required>
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Razón social')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toBeRequired()
    expect(input).toHaveAccessibleDescription('Escribí un nombre. Como figura en el CUIT.')
  })

  it('sin error no marca aria-invalid; «(opcional)» forma parte del label', () => {
    render(
      <Field label="Referencia" optional>
        <Input />
      </Field>,
    )
    const input = screen.getByLabelText('Referencia (opcional)')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).not.toHaveAttribute('aria-describedby')
  })

  it('respeta id y aria-describedby propios del control', () => {
    render(
      <>
        <p id="externo">Texto externo</p>
        <Field label="Notas" help="Máximo 500 caracteres." id="notas">
          <Textarea aria-describedby="externo" />
        </Field>
      </>,
    )
    const t = screen.getByLabelText('Notas')
    expect(t).toHaveAttribute('id', 'notas')
    expect(t).toHaveAccessibleDescription('Texto externo Máximo 500 caracteres.')
  })

  it('Select nativo etiquetado; la flecha no se lee', () => {
    render(
      <Field label="Moneda">
        <Select defaultValue="USD">
          <option value="ARS">Pesos</option>
          <option value="USD">Dólares</option>
        </Select>
      </Field>,
    )
    const s = screen.getByRole('combobox', { name: 'Moneda' })
    expect(s).toHaveValue('USD')
    expect(s.parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('label oculto sigue siendo el nombre accesible', () => {
    render(
      <Field label="Buscar" hideLabel>
        <Input type="search" />
      </Field>,
    )
    expect(screen.getByRole('searchbox', { name: 'Buscar' })).toBeInTheDocument()
  })

  it('Checkbox con ayuda y Switch con role switch', () => {
    render(
      <>
        <Checkbox label="Incluir IVA" help="Se discrimina al imprimir." />
        <Switch label="Copia al vendedor" defaultChecked />
      </>,
    )
    expect(screen.getByRole('checkbox', { name: 'Incluir IVA' })).toHaveAccessibleDescription('Se discrimina al imprimir.')
    expect(screen.getByRole('switch', { name: 'Copia al vendedor' })).toBeChecked()
  })

  it('readonly y disabled se conservan', () => {
    render(
      <>
        <Field label="Número">
          <Input readOnly value="COTI-00020" />
        </Field>
        <Field label="Bloqueado">
          <Input disabled value="x" />
        </Field>
      </>,
    )
    expect(screen.getByLabelText('Número')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('Bloqueado')).toBeDisabled()
  })
})
