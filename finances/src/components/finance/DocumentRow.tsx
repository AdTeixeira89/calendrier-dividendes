import { FileText, Image as ImageIcon } from 'lucide-react'
import type { AppDocument } from '@/types'
import { DOCUMENT_KIND_LABELS } from '@/types/document'
import { formatDate } from '@/utils/dates'
import styles from './TransactionRow.module.css'

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} Ko` : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
}

export function DocumentRow({ document, onClick }: { document: AppDocument; onClick: () => void }) {
  const isImage = document.mimeType.startsWith('image/')
  return (
    <button type="button" className={styles.row} onClick={onClick}>
      <span style={{ display: 'grid', placeItems: 'center', flex: 'none', width: 36, height: 36, borderRadius: 10, background: 'var(--surface-hover)', color: 'var(--accent)' }}>
        {isImage ? <ImageIcon size={16} aria-hidden /> : <FileText size={16} aria-hidden />}
      </span>
      <span className={styles.info}>
        <strong>{document.name}</strong>
        <span className="subtle">
          {DOCUMENT_KIND_LABELS[document.kind]} · {document.createdAt ? formatDate(document.createdAt.toDate()) : '…'} · {formatSize(document.sizeBytes)}
        </span>
      </span>
    </button>
  )
}
