import { useRef, useState, type FormEvent } from 'react'
import { FileUp, Upload } from 'lucide-react'
import { Button, Notice, Select, Sheet, TextField } from '@/components/ui'
import { useCurrentUser } from '@/hooks/useAuth'
import { useHousehold } from '@/hooks/useHousehold'
import { createDocument } from '@/services/documentService'
import { uploadHouseholdFile } from '@/services/storageService'
import { DOCUMENT_KIND_LABELS, type DocumentKind } from '@/types/document'
import { toUserMessage } from '@/utils/firebaseErrors'

const KINDS: DocumentKind[] = ['invoice', 'statement', 'contract', 'receipt', 'other']

export function ImportDocumentSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<DocumentKind>('invoice')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function reset() {
    setFile(null)
    setName('')
    setKind('invoice')
    setError(null)
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) return setError('Choisissez un fichier (PDF ou photo).')
    if (!name.trim()) return setError('Donnez un nom à ce document.')
    setError(null)
    setLoading(true)
    try {
      const storagePath = await uploadHouseholdFile(household.id, 'documents', file)
      await createDocument(household.id, { name: name.trim(), kind, storagePath, mimeType: file.type, sizeBytes: file.size }, user)
      reset()
      onClose()
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => {
        reset()
        onClose()
      }}
      title="Importer un document"
    >
      <form className="stack" onSubmit={onSubmit} noValidate>
        {error && <Notice tone="danger">{error}</Notice>}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,image/*"
          className="sr-only"
          onChange={(e) => {
            const selected = e.target.files?.[0]
            if (selected) {
              setFile(selected)
              if (!name) setName(selected.name.replace(/\.[^.]+$/, ''))
            }
          }}
        />
        <Button type="button" variant="secondary" icon={<FileUp size={18} />} onClick={() => inputRef.current?.click()}>
          {file ? file.name : 'Choisir un fichier (PDF ou photo)'}
        </Button>
        <TextField label="Nom du document" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        <Select label="Type" value={kind} onChange={(e) => setKind(e.target.value as DocumentKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {DOCUMENT_KIND_LABELS[k]}
            </option>
          ))}
        </Select>
        <Button type="submit" size="lg" block loading={loading} icon={<Upload size={18} />}>
          Importer
        </Button>
      </form>
    </Sheet>
  )
}
