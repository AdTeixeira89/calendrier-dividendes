import type { StructuredAnswer } from '@/services/aiService'
import { Notice } from '@/components/ui'

const SECTIONS: { key: 'data' | 'calculations' | 'estimates'; title: string }[] = [
  { key: 'data', title: 'Données' },
  { key: 'calculations', title: 'Calculs' },
  { key: 'estimates', title: 'Estimations' },
]

/**
 * Affiche une réponse IA structurée : chaque chiffre garde son étiquette et
 * sa source, jamais un texte libre qui mélangerait fait et interprétation.
 */
export function StructuredAnswerView({ answer }: { answer: StructuredAnswer }) {
  const isEmpty = answer.data.length === 0 && answer.calculations.length === 0 && answer.estimates.length === 0 && answer.suggestions.length === 0

  if (isEmpty) {
    return <Notice tone="info">Aucune donnée du foyer ne permet de répondre à cette question pour l'instant.</Notice>
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      {SECTIONS.map(({ key, title }) => {
        const items = answer[key]
        if (items.length === 0) return null
        return (
          <div key={key} className="stack" style={{ gap: 4 }}>
            <span className="subtle" style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.4 }}>
              {title}
            </span>
            <ul className="stack" style={{ gap: 4 }}>
              {items.map((item, i) => (
                <li key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                  <span>{item.label}</span>
                  <strong className="num">{item.value}</strong>
                </li>
              ))}
            </ul>
          </div>
        )
      })}
      {answer.suggestions.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="subtle" style={{ textTransform: 'uppercase', fontSize: 12, letterSpacing: 0.4 }}>
            Suggestions
          </span>
          <ul className="stack" style={{ gap: 4 }}>
            {answer.suggestions.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
