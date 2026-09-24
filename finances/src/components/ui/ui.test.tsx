import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar'
import { StatCard } from './StatCard'

describe('design system', () => {
  it('ProgressBar borne la valeur et reste accessible', () => {
    render(<ProgressBar value={130} label="Vacances" />)
    const bar = screen.getByRole('progressbar', { name: 'Vacances' })
    expect(bar).toHaveAttribute('aria-valuenow', '100')
  })

  it('StatCard affiche montant et tendance', () => {
    render(<StatCard label="Épargne" amount={215000} change={8.4} />)
    expect(screen.getByText('Épargne')).toBeInTheDocument()
    expect(screen.getByText(/2\s150\s€/)).toBeInTheDocument()
    expect(screen.getByText(/\+8,4\s%/)).toBeInTheDocument()
  })

  it('StatCard sans données affiche un tiret', () => {
    render(<StatCard label="Revenus" amount={null} footnote="Aucun revenu saisi" />)
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})
