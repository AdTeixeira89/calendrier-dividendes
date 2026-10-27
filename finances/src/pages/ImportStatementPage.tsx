import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, FileUp } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button, Card, Notice, TextField } from '@/components/ui'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { groupByParent, useCategories } from '@/hooks/useCategories'
import { useCurrentUser } from '@/hooks/useAuth'
import { useCategoryRules } from '@/hooks/useCategoryRules'
import { useExpensesRange } from '@/hooks/useExpensesRange'
import { useHousehold } from '@/hooks/useHousehold'
import { useIncomesRange } from '@/hooks/useIncomesRange'
import { importStatement, type ImportResult } from '@/services/statementImportService'
import { INCOME_TYPE_LABELS } from '@/types/income'
import type { StatementRow } from '@/utils/bankStatement'
import { readStatementFile } from '@/utils/statementFile'
import { COMMON_SPACE, type Space } from '@/utils/spaces'
import { toUserMessage } from '@/utils/firebaseErrors'
import { formatCents, parseAmountToCents } from '@/utils/money'
import { currentMonthKey, monthKey, shiftMonth } from '@/utils/month'
import { resolveCategoryId } from '@/utils/recurringExpenses'
import { buildImportPreview, type PreviewRow } from '@/utils/statementImport'
import styles from './ImportStatementPage.module.css'

const MAX_BYTES = 5 * 1024 * 1024
const FLAG_LABELS = { imported: 'Déjà importée', duplicate: 'Déjà saisie ? (même montant, même jour)', transfer: 'Virement entre vos comptes' } as const

interface Parsed {
  rows: StatementRow[]
  skipped: number
  from: string
  to: string
}

export function ImportStatementPage() {
  const user = useCurrentUser()
  const { household, members, canWrite } = useHousehold()
  const categories = useCategories(household.id, 'expense')
  const inputRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Partial<Pick<PreviewRow, 'include' | 'categoryId' | 'merchant' | 'date' | 'amountCents' | 'kind'>>>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [space, setSpace] = useState<Space>(COMMON_SPACE)
  const [error, setError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)

  // Historique des 12 derniers mois (apprentissage des catégories, détection des doublons), élargi à la période du relevé.
  const current = currentMonthKey()
  const expenses = useExpensesRange(household.id, parsed && parsed.from < shiftMonth(current, -11) ? parsed.from : shiftMonth(current, -11), parsed && parsed.to > current ? parsed.to : current)
  const rules = useCategoryRules(household.id)
  const incomes = useIncomesRange(household.id, parsed && parsed.from < shiftMonth(current, -11) ? parsed.from : shiftMonth(current, -11), parsed && parsed.to > current ? parsed.to : current)

  const preview = useMemo(
    () => (parsed && categories && expenses && incomes && rules ? buildImportPreview(parsed.rows, { categories, expenses, incomes, rules }) : null),
    [parsed, categories, expenses, incomes, rules],
  )
  const rows = useMemo(() => preview?.map((p) => ({ ...p, ...overrides[p.id] })) ?? null, [preview, overrides])
  const groups = categories ? groupByParent(categories) : []

  async function onFile(file: File) {
    setError(null)
    setResult(null)
    setOverrides({})
    setParsed(null)
    if (file.size > MAX_BYTES) return setError('Fichier trop volumineux (5 Mo maximum).')
    try {
      const outcome = await readStatementFile(file)
      if (!outcome.ok) return setError(outcome.error)
      const keys = outcome.rows.map((r) => monthKey(r.date)).sort()
      setParsed({ rows: outcome.rows, skipped: outcome.skipped, from: keys[0]!, to: keys[keys.length - 1]! })
    } catch (err) {
      setError(toUserMessage(err))
    }
  }

  function setRow(id: string, changes: Partial<Pick<PreviewRow, 'include' | 'categoryId' | 'merchant' | 'date' | 'amountCents' | 'kind'>>) {
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...changes } }))
  }

  function setAll(include: boolean) {
    if (!rows) return
    setOverrides((o) => Object.fromEntries(rows.map((r) => [r.id, { ...o[r.id], include: include && r.flag !== 'imported' }])))
  }

  const selected = rows?.filter((r) => r.include) ?? []
  const selectedExpenses = selected.filter((r) => r.kind === 'expense')
  const selectedIncomes = selected.filter((r) => r.kind === 'income')
  const toCheck = selectedExpenses.filter((r) => r.categoryId === null).length
  const fallbackCategoryId = categories ? resolveCategoryId(null, categories) : null

  async function onImport() {
    if (selected.length === 0 || !fallbackCategoryId) return
    setImporting(true)
    setError(null)
    try {
      setResult(await importStatement(household.id, selected, fallbackCategoryId, user, space))
    } catch (err) {
      setError(toUserMessage(err))
    } finally {
      setImporting(false)
    }
  }

  if (result) {
    const latest = selected.map((r) => monthKey(r.date)).sort().pop() ?? current
    return (
      <div className="stack animate-in">
        <PageHeader title="Relevé importé" />
        <Notice tone="success">
          <span className="row" style={{ gap: 6 }}>
            <CheckCircle2 size={16} aria-hidden />
            {result.created} opération{result.created > 1 ? 's' : ''} importée{result.created > 1 ? 's' : ''}
            {result.remembered > 0 && ` · ${result.remembered} catégorie${result.remembered > 1 ? 's' : ''} retenue${result.remembered > 1 ? 's' : ''} pour les prochains relevés`}
            {result.alreadyThere > 0 && ` · ${result.alreadyThere} déjà présente${result.alreadyThere > 1 ? 's' : ''}, ignorée${result.alreadyThere > 1 ? 's' : ''}`}.
          </span>
        </Notice>
        <Link to={`/depenses?mois=${latest}`}>
          <Button block>Voir les dépenses</Button>
        </Link>
        <Button
          variant="secondary"
          onClick={() => {
            setResult(null)
            setParsed(null)
          }}
        >
          Importer un autre relevé
        </Button>
      </div>
    )
  }

  return (
    <div className="stack animate-in">
      <PageHeader title="Importer un relevé" subtitle="Plus besoin de tout saisir à la main." />

      {!canWrite && <Notice tone="warning">Votre rôle dans ce foyer ne permet pas d'ajouter des opérations.</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      {!parsed && (
        <Card title="Comment faire">
          <div className="stack">
            <ol className="stack" style={{ gap: 4 }}>
              <li>1. Dans le site ou l'app de votre banque, exportez vos opérations au format Excel (.xlsx) ou CSV.</li>
              <li>2. Choisissez le fichier ici : l'app reconnaît les colonnes toute seule (date, libellé, montant ou débit / crédit).</li>
              <li>3. Relisez la liste : changez la catégorie, le libellé, la date ou le montant d'une ligne si besoin, puis validez.</li>
            </ol>
            <p className="subtle">Le fichier est lu sur votre téléphone. Seules les opérations que vous validez sont enregistrées ; relire le même relevé ne crée aucun doublon.</p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/vnd.ms-excel"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void onFile(file)
                e.target.value = ''
              }}
            />
            <Button size="lg" block icon={<FileUp size={20} />} disabled={!canWrite} onClick={() => inputRef.current?.click()}>
              Choisir un relevé (Excel ou CSV)
            </Button>
          </div>
        </Card>
      )}

      {parsed && !rows && <p className="muted">Analyse du relevé…</p>}

      {parsed && rows && (
        <>
          <Card title={`${rows.length} opération${rows.length > 1 ? 's' : ''} lue${rows.length > 1 ? 's' : ''}`}>
            <div className="stack">
              <p>
                À importer : <strong>{selectedExpenses.length} dépense{selectedExpenses.length > 1 ? 's' : ''}</strong>
                {' '}({formatCents(selectedExpenses.reduce((s, r) => s + r.amountCents, 0))}) et <strong>{selectedIncomes.length} revenu{selectedIncomes.length > 1 ? 's' : ''}</strong>
                {' '}({formatCents(selectedIncomes.reduce((s, r) => s + r.amountCents, 0))}).
              </p>
              {parsed.skipped > 0 && <p className="subtle">{parsed.skipped} ligne{parsed.skipped > 1 ? 's' : ''} ignorée{parsed.skipped > 1 ? 's' : ''} (totaux, soldes, lignes incomplètes).</p>}
              {rows.some((r) => r.flag) && <p className="subtle">Les opérations signalées sont décochées : cochez-les si vous voulez quand même les importer.</p>}
              {toCheck > 0 && (
                <Notice tone="warning">
                  {toCheck} dépense{toCheck > 1 ? 's' : ''} sans catégorie reconnue : choisissez-{toCheck > 1 ? 'les' : 'la'}, sinon {toCheck > 1 ? 'elles iront' : 'elle ira'} dans « Autres ».
                </Notice>
              )}
              <SegmentedControl label="Dépenses importées dans l'espace" value={space} onChange={setSpace} options={[{ value: COMMON_SPACE, label: 'Communes' }, ...members.map((m) => ({ value: m.uid, label: m.displayName }))]} />
              <Button size="lg" block loading={importing} disabled={selected.length === 0 || !fallbackCategoryId || !canWrite} onClick={() => void onImport()}>
                Importer {selected.length} opération{selected.length > 1 ? 's' : ''}
              </Button>
              <div className={styles.bar}>
                <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
                  Tout cocher
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setAll(false)}>
                  Tout décocher
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setParsed(null)}>
                  Changer de fichier
                </Button>
              </div>
            </div>
          </Card>

          <Card padded={false}>
            <ul className={styles.list}>
              {rows.map((row) => (
                <li key={row.id} className={[styles.row, !row.include && styles.muted].filter(Boolean).join(' ')}>
                  <label className={styles.check}>
                    <input type="checkbox" checked={row.include} onChange={(e) => setRow(row.id, { include: e.target.checked })} aria-label={`Importer ${row.merchant}`} />
                  </label>
                  <div className={styles.main}>
                    <div className={styles.top}>
                      <strong>{row.merchant}</strong>
                      <span className={`num ${row.kind === 'income' ? styles.income : styles.expense}`}>
                        {row.kind === 'income' ? '+' : '−'}
                        {formatCents(row.amountCents)}
                      </span>
                    </div>
                    <span className={`${styles.sub} subtle`}>
                      {row.date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {row.label}
                    </span>
                    {row.flag && <span className={`${styles.chip} ${styles.chipWarn}`}>{FLAG_LABELS[row.flag]}</span>}
                    {row.kind === 'expense' && (row.suggestion === 'memory' || row.suggestion === 'history') && <span className={styles.chip}>Catégorie retenue</span>}
                    {editingId === row.id && (
                      <div className="stack" style={{ marginTop: 4 }}>
                        <TextField label="Libellé" maxLength={120} value={row.merchant} onChange={(e) => setRow(row.id, { merchant: e.target.value })} />
                        <div className="row" style={{ alignItems: 'flex-start' }}>
                          <TextField
                            label="Date"
                            type="date"
                            value={toInputDate(row.date)}
                            onChange={(e) => {
                              const next = fromInputDate(e.target.value)
                              if (next) setRow(row.id, { date: next })
                            }}
                          />
                          <TextField
                            label="Montant"
                            inputMode="decimal"
                            defaultValue={String(row.amountCents / 100).replace('.', ',')}
                            trailing={<span className="subtle">€</span>}
                            onChange={(e) => {
                              const cents = parseAmountToCents(e.target.value)
                              if (cents !== null && cents > 0) setRow(row.id, { amountCents: cents })
                            }}
                          />
                        </div>
                        <SegmentedControl
                          label="Type"
                          value={row.kind}
                          onChange={(kind) => setRow(row.id, { kind })}
                          options={[
                            { value: 'expense', label: 'Dépense' },
                            { value: 'income', label: 'Revenu' },
                          ]}
                        />
                        <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                          OK
                        </Button>
                      </div>
                    )}
                    {editingId !== row.id && (
                      <Button size="sm" variant="ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setEditingId(row.id)} aria-label={`Modifier ${row.merchant}`}>
                        Modifier
                      </Button>
                    )}
                    {row.kind === 'income' ? (
                      <span className={styles.chip}>Revenu · {INCOME_TYPE_LABELS[row.incomeType]}</span>
                    ) : (
                      <select
                        className={[styles.select, row.categoryId === null && styles.toCheck].filter(Boolean).join(' ')}
                        value={row.categoryId ?? ''}
                        aria-label={`Catégorie de ${row.merchant}`}
                        onChange={(e) => setRow(row.id, { categoryId: e.target.value || null })}
                      >
                        <option value="" disabled={false}>
                          À vérifier — « Autres » par défaut
                        </option>
                        {groups.map((group) => (
                          <optgroup key={group.id} label={group.name}>
                            <option value={group.id}>{group.name}</option>
                            {group.children.map((child) => (
                              <option key={child.id} value={child.id}>
                                {group.name} › {child.name}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  )
}

/** Date locale au format AAAA-MM-JJ (champ date). */
function toInputDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** AAAA-MM-JJ → date locale à midi (comme les saisies manuelles), ou null si invalide. */
function fromInputDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null
}
