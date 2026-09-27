import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Camera, ExternalLink, FileText, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { DocumentRow } from '@/components/finance/DocumentRow'
import { ExpenseFormSheet, type ExpenseFormInitial } from '@/components/finance/ExpenseFormSheet'
import { ImportDocumentSheet } from '@/components/finance/ImportDocumentSheet'
import { ScanReceiptSheet } from '@/components/finance/ScanReceiptSheet'
import { Button, Card, ConfirmButton, EmptyState, Notice, Sheet } from '@/components/ui'
import { useCategories } from '@/hooks/useCategories'
import { useCurrentUser } from '@/hooks/useAuth'
import { useDocuments } from '@/hooks/useDocuments'
import { useHousehold } from '@/hooks/useHousehold'
import { deleteDocument } from '@/services/documentService'
import { getFileUrl } from '@/services/storageService'
import type { AppDocument } from '@/types'
import { DOCUMENT_KIND_LABELS } from '@/types/document'
import { currentMonthKey } from '@/utils/month'
import { toUserMessage } from '@/utils/firebaseErrors'

export function DocumentsPage() {
  const user = useCurrentUser()
  const { household } = useHousehold()
  const categories = useCategories(household.id, 'expense')
  const documents = useDocuments(household.id)
  const [params, setParams] = useSearchParams()
  const [scanExtraction, setScanExtraction] = useState<ExpenseFormInitial | null>(null)
  const [viewing, setViewing] = useState<AppDocument | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scannerOpen = params.has('scanner')
  const importerOpen = params.has('importer')

  function closeParam(key: string) {
    const next = new URLSearchParams(params)
    next.delete(key)
    setParams(next, { replace: true })
  }

  return (
    <div className="stack animate-in">
      <PageHeader title="Documents" subtitle="Tickets scannés et documents importés." />
      {error && <Notice tone="danger">{error}</Notice>}

      <div className="row">
        <Button icon={<Camera size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), scanner: '1' }))}>
          Scanner un ticket
        </Button>
        <Button variant="secondary" icon={<Upload size={18} />} onClick={() => setParams((p) => new URLSearchParams({ ...Object.fromEntries(p), importer: '1' }))}>
          Importer un document
        </Button>
      </div>

      <Card title="Documents importés" padded={documents !== undefined && documents.length === 0}>
        {documents === undefined ? null : documents.length === 0 ? (
          <EmptyState icon={<FileText size={28} />} title="Aucun document" description="Factures, relevés, contrats… Les tickets scannés sont rattachés directement à leur dépense." />
        ) : (
          <ul className="stack" style={{ gap: 2 }}>
            {documents.map((doc) => (
              <li key={doc.id}>
                <DocumentRow document={doc} onClick={() => setViewing(doc)} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ScanReceiptSheet
        open={scannerOpen}
        onClose={() => closeParam('scanner')}
        onExtracted={(initial) => {
          closeParam('scanner')
          setScanExtraction(initial)
        }}
      />

      {categories !== undefined && (
        <ExpenseFormSheet
          key={scanExtraction?.receiptPath ?? 'none'}
          open={scanExtraction !== null}
          onClose={() => setScanExtraction(null)}
          categories={categories}
          defaultDate={`${currentMonthKey()}-01`}
          initial={scanExtraction ?? undefined}
        />
      )}

      <ImportDocumentSheet open={importerOpen} onClose={() => closeParam('importer')} />

      <Sheet open={viewing !== null} onClose={() => setViewing(null)} title={viewing?.name ?? 'Document'}>
        {viewing && (
          <div className="stack">
            <p className="subtle">
              {DOCUMENT_KIND_LABELS[viewing.kind]} · ajouté le {viewing.createdAt ? viewing.createdAt.toDate().toLocaleDateString('fr-FR') : '…'}
            </p>
            <Button
              icon={<ExternalLink size={18} />}
              onClick={async () => {
                try {
                  window.open(await getFileUrl(viewing.storagePath), '_blank', 'noopener')
                } catch (err) {
                  setError(toUserMessage(err))
                }
              }}
            >
              Ouvrir le document
            </Button>
            <ConfirmButton
              label="Supprimer"
              icon={<Trash2 size={18} />}
              question={`Supprimer « ${viewing.name} » ?`}
              onConfirm={() => {
                void deleteDocument(household.id, viewing.id, viewing.storagePath, user)
                  .then(() => setViewing(null))
                  .catch((err: unknown) => setError(toUserMessage(err)))
              }}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
