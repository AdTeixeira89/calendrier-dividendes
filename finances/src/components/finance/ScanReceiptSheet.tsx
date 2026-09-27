import { useRef, useState } from 'react'
import { Camera, ScanLine } from 'lucide-react'
import { Button, Notice, Sheet, Spinner } from '@/components/ui'
import { recognizeReceiptText } from '@/ocr/recognize'
import { parseReceiptText } from '@/ocr/parseReceipt'
import { useHousehold } from '@/hooks/useHousehold'
import { uploadHouseholdFile } from '@/services/storageService'
import { toUserMessage } from '@/utils/firebaseErrors'
import type { ExpenseFormInitial } from './ExpenseFormSheet'
import styles from './ScanReceiptSheet.module.css'

interface ScanReceiptSheetProps {
  open: boolean
  onClose: () => void
  /** Appelé une fois le ticket analysé et téléversé : ouvre le formulaire de dépense pré-rempli. */
  onExtracted: (initial: ExpenseFormInitial) => void
}

type Step = 'pick' | 'analyzing' | 'error'

/**
 * Photo de ticket → OCR → pré-remplissage d'une dépense. L'extraction n'est
 * qu'une proposition : rien n'est jamais enregistré ici, l'utilisateur valide
 * toujours dans le formulaire de dépense qui s'ouvre ensuite.
 */
export function ScanReceiptSheet({ open, onClose, onExtracted }: ScanReceiptSheetProps) {
  const { household } = useHousehold()
  const [step, setStep] = useState<Step>('pick')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  function reset() {
    setStep('pick')
    setError(null)
  }

  async function onFileSelected(file: File) {
    setStep('analyzing')
    setError(null)
    try {
      // Le ticket est déposé même si la lecture automatique échoue ensuite :
      // l'utilisateur pourra toujours saisir les champs à la main avec la
      // photo jointe. Seul un échec du dépôt du fichier bloque le scan.
      const receiptPath = await uploadHouseholdFile(household.id, 'receipts', file)
      let extraction = { merchant: null as string | null, date: null as string | null, totalCents: null as number | null }
      try {
        extraction = parseReceiptText(await recognizeReceiptText(file))
      } catch (ocrErr) {
        console.error('Lecture automatique du ticket impossible, saisie manuelle nécessaire.', ocrErr)
      }
      onExtracted({
        amountCents: extraction.totalCents ?? undefined,
        date: extraction.date ?? undefined,
        merchant: extraction.merchant ?? undefined,
        receiptPath,
      })
      reset()
    } catch (err) {
      setError(toUserMessage(err))
      setStep('error')
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Scanner un ticket"
    >
      <div className="stack">
        {step === 'pick' && (
          <>
            <p className="muted">Prenez le ticket en photo, bien à plat et lisible. Vous pourrez vérifier et corriger les informations avant d'enregistrer la dépense.</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onFileSelected(file)
              }}
            />
            <Button size="lg" block icon={<Camera size={20} />} onClick={() => inputRef.current?.click()}>
              Prendre une photo
            </Button>
          </>
        )}
        {step === 'analyzing' && (
          <div className={styles.analyzing}>
            <Spinner size={32} />
            <p className="muted">Lecture du ticket en cours…</p>
          </div>
        )}
        {step === 'error' && (
          <>
            {error && <Notice tone="danger">{error}</Notice>}
            <Button size="lg" block icon={<ScanLine size={20} />} onClick={reset}>
              Réessayer
            </Button>
          </>
        )}
      </div>
    </Sheet>
  )
}
