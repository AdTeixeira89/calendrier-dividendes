import { useState, type FormEvent, type ReactNode } from 'react'
import type { AlertSettings } from '@shared/alerts'
import { Button, Card, Notice } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { saveAlertSettings } from '@/services/alertSettingsService'
import { toUserMessage } from '@/utils/firebaseErrors'
import styles from './Settings.module.css'

function Rule({ label, description, checked, onChange, disabled, children }: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void; disabled: boolean; children?: ReactNode }) {
  return (
    <div className={styles.rule}>
      <label className={styles.ruleHead}>
        <span className={styles.ruleText}>
          <strong>{label}</strong>
          <span className="subtle">{description}</span>
        </span>
        <input type="checkbox" role="switch" className={styles.switch} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {checked && children}
    </div>
  )
}

function NumberSetting({ label, suffix, value, min, max, onChange, disabled }: { label: string; suffix: string; value: number; min: number; max: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className={styles.number}>
      <span className="subtle">{label}</span>
      <span className={styles.numberInput}>
        <input type="number" inputMode="numeric" min={min} max={max} value={value} disabled={disabled} onChange={(e) => onChange(Math.min(max, Math.max(min, Math.round(Number(e.target.value) || min))))} />
        <span className="subtle">{suffix}</span>
      </span>
    </label>
  )
}

/** Réglages des alertes, communs à tout le foyer (carte d'accueil et notifications). */
export function AlertSettingsCard({ initial }: { initial: AlertSettings }) {
  const user = useCurrentUser()
  const { household, canWrite } = useHousehold()
  const [settings, setSettings] = useState(initial)
  const [status, setStatus] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const readOnly = !canWrite

  function update<K extends keyof AlertSettings>(rule: K, changes: Partial<AlertSettings[K]>) {
    setSettings((s) => ({ ...s, [rule]: { ...s[rule], ...changes } }))
    setStatus(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await saveAlertSettings(household.id, settings, user)
      setStatus({ tone: 'success', text: 'Réglages des alertes enregistrés.' })
    } catch (err) {
      setStatus({ tone: 'danger', text: toUserMessage(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card title="Alertes" subtitle="Communes à tout le foyer : carte de l'accueil et notifications.">
      <form className="stack" onSubmit={onSubmit}>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Rule label="Budgets" description="Budget des dépenses communes proche d'être atteint ou dépassé." checked={settings.budget.enabled} onChange={(enabled) => update('budget', { enabled })} disabled={readOnly}>
          <NumberSetting label="Prévenir à partir de" suffix="% du budget" value={settings.budget.warnPercent} min={50} max={100} onChange={(warnPercent) => update('budget', { warnPercent })} disabled={readOnly} />
        </Rule>
        <Rule label="Dépenses > revenus" description="Les dépenses du mois (prêts compris) dépassent les revenus." checked={settings.overspend.enabled} onChange={(enabled) => update('overspend', { enabled })} disabled={readOnly} />
        <Rule label="Prélèvements d'abonnements" description="Rappel avant la date du prochain prélèvement." checked={settings.subscription.enabled} onChange={(enabled) => update('subscription', { enabled })} disabled={readOnly}>
          <NumberSetting label="Prévenir" suffix="jours avant" value={settings.subscription.daysBefore} min={0} max={30} onChange={(daysBefore) => update('subscription', { daysBefore })} disabled={readOnly} />
        </Rule>
        <Rule label="Taux d'épargne" description="Taux du mois écoulé sous votre objectif." checked={settings.savingsRate.enabled} onChange={(enabled) => update('savingsRate', { enabled })} disabled={readOnly}>
          <NumberSetting label="Objectif" suffix="%" value={settings.savingsRate.minPercent} min={1} max={90} onChange={(minPercent) => update('savingsRate', { minPercent })} disabled={readOnly} />
        </Rule>
        {canWrite ? (
          <Button type="submit" variant="secondary" loading={saving}>
            Enregistrer les alertes
          </Button>
        ) : (
          <p className="subtle">Seuls les membres pouvant modifier le foyer changent ces réglages.</p>
        )}
      </form>
    </Card>
  )
}
