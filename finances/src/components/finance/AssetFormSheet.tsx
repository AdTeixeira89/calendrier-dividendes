import { useState, type FormEvent } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Trash2 } from 'lucide-react'
import { Button, ConfirmButton, Notice, Select, Sheet, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createAsset, deleteAsset, recordAssetValuation, updateAsset } from '@/services/assetService'
import type { Asset } from '@/types'
import { ASSET_TYPE_LABELS, type AssetType } from '@/types/asset'
import { toUserMessage } from '@/utils/firebaseErrors'

const TYPES: AssetType[] = ['account', 'savings', 'investment', 'real_estate', 'vehicle', 'other']

const toCents = (v: string) => Math.round(Number(v.replace(',', '.') || '0') * 100)
const toDisplay = (cents: number) => (cents ? String(cents / 100) : '')

interface AssetFormSheetProps {
  open: boolean
  onClose: () => void
  asset?: Asset
}

export function AssetFormSheet({ open, onClose, asset }: AssetFormSheetProps) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const [name, setName] = useState(asset?.name ?? '')
  const [type, setType] = useState<AssetType>(asset?.type ?? 'savings')
  const [value, setValue] = useState(asset ? toDisplay(asset.valueCents) : '')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !value) return setError('Renseignez au moins le nom et la valeur actuelle.')
    setError(null)
    setLoading(true)
    const valueCents = toCents(value)
    try {
      if (asset) {
        if (name.trim() !== asset.name || type !== asset.type) {
          await updateAsset(household.id, asset.id, { name: name.trim(), type }, user)
        }
        if (valueCents !== asset.valueCents) {
          await recordAssetValuation(household.id, asset, valueCents, user)
        }
      } else {
        await createAsset(household.id, { name: name.trim(), type, valueCents, valuedAt: Timestamp.now(), history: [], archived: false }, user)
      }
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  async function onDelete() {
    if (!asset) return
    setLoading(true)
    try {
      await deleteAsset(household.id, asset.id, user)
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={asset ? 'Modifier cet actif' : 'Nouvel actif'}>
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Nom" placeholder="Ex. Livret A, Appartement, PEA…" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value as AssetType)}>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABELS[t]}
            </option>
          ))}
        </Select>
        <TextField
          label="Valeur actuelle"
          inputMode="decimal"
          required
          value={value}
          onChange={(e) => setValue(e.target.value)}
          trailing={<span className="subtle">€</span>}
          hint={asset ? "Changez ce montant pour enregistrer une nouvelle valorisation (l'ancienne reste dans l'historique)." : undefined}
        />
        <Button type="submit" size="lg" block loading={loading}>
          {asset ? 'Enregistrer' : "Ajouter l'actif"}
        </Button>
        {asset && <ConfirmButton label="Supprimer" icon={<Trash2 size={18} />} question={`Supprimer « ${asset.name} » ?`} onConfirm={() => void onDelete()} disabled={loading} />}
      </form>
    </Sheet>
  )
}
