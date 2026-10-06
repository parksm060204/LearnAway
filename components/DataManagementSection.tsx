'use client';

import React, { useRef, useState } from 'react';
import { Database, Download, Upload, CheckCircle2, DatabaseBackup } from 'lucide-react';
import type { Material, Subject } from '../lib/types';
import {
  loadMaterialContentResult,
  loadMaterialOriginal,
  loadMaterialContentInScope,
  loadMaterialOriginalInScope,
  saveMaterialContentInScope,
  saveMaterialOriginalInScope,
} from '../lib/materialStorage';
import {
  MATERIAL_BACKUP_LIMITS,
  backupContainsSecrets,
  buildMaterialBackup,
  findBackupLimitViolations,
  materialBackupBlobParts,
  measureMaterialBackupPartsSize,
  parseMaterialBackup,
  summarizeBackupCompleteness,
  verifyBackupOriginalHashes,
  type MaterialBackupFile,
} from '../lib/materialPolicy';
import { executeMaterialRestore } from '../lib/materialRestore';
import { getStorageScopeId } from '../lib/storageScope';

export interface MigrationUiBlock {
  key: string;
  title: string;
  description: string;
  pending: boolean;
  busy: boolean;
  actionLabel: string;
  onMigrate?: () => void;
  onDecline: () => void;
  declineLabel?: string;
}

interface DataManagementSectionProps {
  migrations: MigrationUiBlock[];
  materials: Material[];
  subjects: Subject[];
  /** Persists restored metadata; must resolve false when the save is unverified. */
  onRestoreMaterials: (restored: Material[]) => boolean | Promise<boolean>;
}

interface ExportResult {
  total: number;
  withFiles: number;
  issues: Array<{ id: string; title: string; which: 'body' | 'original'; state: 'absent' | 'error'; message?: string }>;
  complete: boolean;
  error?: string;
  limitViolations?: Array<{ id: string | null; title: string | null; reason: string }>;
}

interface ImportResult {
  restored: string[];
  skippedExisting: string[];
  conflicts: Array<{ id: string; title: string; reason: string }>;
  failed: Array<{ id: string; title: string; reason: string }>;
  missing: Array<{ id: string; title: string; which: Array<'body' | 'original'> }>;
  aborted: boolean;
}

interface PendingSubjectChoice {
  backup: MaterialBackupFile;
  unknownSubjectIds: string[];
  choices: Record<string, string>;
}

const WHICH_LABELS: Record<'body' | 'original', string> = {
  body: '본문',
  original: '원본',
};

export function DataManagementSection({
  migrations,
  materials,
  subjects,
  onRestoreMaterials,
}: DataManagementSectionProps) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [pendingSubjectChoice, setPendingSubjectChoice] = useState<PendingSubjectChoice | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const pendingMigrations = migrations.filter((m) => m.pending);

  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportResult(null);
    try {
      const backup = await buildMaterialBackup(materials, {
        loadBody: async (id) => {
          const result = await loadMaterialContentResult(id);
          if (result.status === 'found') {
            return {
              status: 'found' as const,
              body: { markdown: result.content.markdown, rawText: result.content.rawText, pages: result.content.pages },
            };
          }
          if (result.status === 'missing') return { status: 'missing' as const };
          return { status: 'error' as const, error: result.error };
        },
        loadOriginal: async (id) => {
          const result = await loadMaterialOriginal(id);
          if (result.status === 'found') {
            return {
              status: 'found' as const,
              original: {
                contentType: result.contentType,
                hash: result.hash,
                data: new Uint8Array(await result.blob.arrayBuffer()),
              },
            };
          }
          if (result.status === 'missing') return { status: 'missing' as const };
          return { status: 'error' as const, error: result.error };
        },
      });
      const summary = summarizeBackupCompleteness(backup);
      // Serialize ONCE into separate parts and measure them for the SAME limits
      // the import parser uses. The Blob below reuses these parts, so the whole
      // backup is never materialized as a single JSON string and no oversized
      // download is produced.
      const parts = materialBackupBlobParts(backup);
      const serializedSize = measureMaterialBackupPartsSize(parts);
      const limitViolations = findBackupLimitViolations(backup, MATERIAL_BACKUP_LIMITS, serializedSize);
      if (limitViolations.length > 0) {
        setExportResult({
          total: backup.materials.length,
          withFiles: 0,
          issues: summary.issues,
          complete: false,
          error: `백업 파일이 처리 가능한 크기를 초과해 내보내기를 중단했습니다. ${limitViolations.map((v) => v.reason).join(' ')}`,
          limitViolations,
        });
        return;
      }
      const blob = new Blob(parts, { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      anchor.href = url;
      anchor.download = `learnaway-materials-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportResult({
        total: backup.materials.length,
        withFiles: backup.materials.length - summary.materialsWithIssues,
        issues: summary.issues,
        complete: summary.complete,
      });
    } catch (error) {
      setExportResult({
        total: 0,
        withFiles: 0,
        issues: [],
        complete: false,
        error: error instanceof Error ? error.message : '백업 내보내기에 실패했습니다.',
      });
    } finally {
      setExportBusy(false);
    }
  };

  const runRestore = async (
    backup: MaterialBackupFile,
    subjectOverride?: Record<string, string>
  ): Promise<Awaited<ReturnType<typeof executeMaterialRestore>>> => {
    // Pin the storage scope for the whole run: every read, write and
    // verification goes to the account the restore started in, even if the
    // global account changes mid-flight. The scope check below then stops
    // starting NEW writes after a switch, and the metadata callback refuses to
    // touch another account's records or UI.
    const pinnedScopeId = getStorageScopeId();
    const outcome = await executeMaterialRestore(backup.materials, {
      getMaterials: () => materials,
      loadBodyResult: (id) => loadMaterialContentInScope(pinnedScopeId, id, { skipMemoryCache: true }),
      loadOriginalResult: (id) => loadMaterialOriginalInScope(pinnedScopeId, id),
      saveBody: (id, content) => saveMaterialContentInScope(pinnedScopeId, id, content),
      saveOriginal: (id, blob, contentType, knownHash) =>
        saveMaterialOriginalInScope(pinnedScopeId, id, blob, contentType, knownHash),
      persistMetadata: async (added) => {
        if (getStorageScopeId() !== pinnedScopeId) return false;
        return onRestoreMaterials(added);
      },
      getScopeId: () => getStorageScopeId(),
      knownSubjectIds: subjects.map((s) => s.id),
      subjectOverride,
    });
    setImportResult({
      restored: outcome.restored,
      skippedExisting: outcome.skippedExisting,
      conflicts: outcome.conflicts,
      failed: outcome.failed,
      missing: outcome.missing,
      aborted: outcome.aborted,
    });
    return outcome;
  };

  const handleImportFile = async (file: File) => {
    if (importBusy) return;
    setImportBusy(true);
    setImportError('');
    setImportResult(null);
    setPendingSubjectChoice(null);
    try {
      if (file.size > MATERIAL_BACKUP_LIMITS.fileBytes) {
        setImportError('백업 파일이 처리 가능한 크기를 초과했습니다.');
        return;
      }
      const parsed = parseMaterialBackup(await file.text());
      if (!parsed.ok) {
        setImportError(parsed.error);
        return;
      }
      if (backupContainsSecrets(parsed.backup)) {
        setImportError('백업에 인증 정보로 보이는 필드가 포함되어 있어 가져오기를 중단했습니다.');
        return;
      }
      const hashes = await verifyBackupOriginalHashes(parsed.backup);
      if (!hashes.ok) {
        setImportError(
          `원본 해시가 일치하지 않아 가져오기를 중단했습니다: ${hashes.mismatched.map((m) => m.title).join(', ')}`
        );
        return;
      }
      // Only materials whose metadata must be CREATED need a subject choice;
      // entries that already exist locally are compared by their own identity.
      const localMaterialIds = new Set(materials.map((m) => m.id));
      const unknownSubjectIds = Array.from(
        new Set(
          parsed.backup.materials
            .filter((entry) => !localMaterialIds.has(entry.material.id))
            .map((entry) => entry.material.subjectId)
        )
      ).filter((subjectId) => !subjects.some((s) => s.id === subjectId));
      if (unknownSubjectIds.length > 0) {
        if (subjects.length === 0) {
          setImportError('복원 대상 과목이 없습니다. 먼저 과목을 만든 뒤 가져오기를 다시 시도해 주세요.');
          return;
        }
        setPendingSubjectChoice({
          backup: parsed.backup,
          unknownSubjectIds,
          choices: Object.fromEntries(unknownSubjectIds.map((id) => [id, subjects[0].id])),
        });
        return;
      }
      const outcome = await runRestore(parsed.backup);
      if (outcome.blockedBySubject) {
        setImportError('대상 과목을 지정할 수 없는 자료가 있어 복원하지 않았습니다. 대상 과목을 확인해 주세요.');
      }
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '백업을 가져오지 못했습니다.');
    } finally {
      setImportBusy(false);
    }
  };

  const confirmSubjectChoice = async () => {
    if (!pendingSubjectChoice || importBusy) return;
    // Validate the user's picks BEFORE any write: every chosen target must be a
    // subject that still exists in THIS account. A deleted target must be
    // re-chosen instead of writing to a subject that is gone.
    const knownSubjectIds = new Set(subjects.map((s) => s.id));
    const unresolved = pendingSubjectChoice.unknownSubjectIds.filter((sourceSubjectId) => {
      const target = pendingSubjectChoice.choices[sourceSubjectId];
      return !target || !knownSubjectIds.has(target);
    });
    if (unresolved.length > 0) {
      setImportError(
        '선택한 대상 과목을 현재 계정에서 찾을 수 없습니다. 대상 과목을 다시 선택해 주세요.'
      );
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const outcome = await runRestore(pendingSubjectChoice.backup, pendingSubjectChoice.choices);
      if (outcome.blockedBySubject) {
        // Keep the chooser open so the user can resolve the remaining subjects.
        setImportError(
          '대상 과목이 지정되지 않은 자료가 있어 복원하지 않았습니다. 대상 과목을 선택한 뒤 다시 시도해 주세요.'
        );
        return;
      }
      setPendingSubjectChoice(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : '백업을 가져오지 못했습니다.');
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <section className="border border-[#ded6c8] rounded-xs bg-white" aria-label="데이터 관리">
      <div className="bg-[#191817] text-white px-4 py-2.5 flex items-center gap-2">
        <Database className="w-4 h-4 text-[#c52828]" />
        <h4 className="text-xs font-bold">데이터 관리 (이관 · 백업/복원)</h4>
      </div>
      <div className="p-4 space-y-4 text-xs">
        <div className="space-y-2.5">
          <h5 className="font-bold text-[#191817]">클라우드 이관</h5>
          {pendingMigrations.length === 0 ? (
            <p className="text-[11px] text-emerald-700 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" /> 이관할 항목이 없습니다. 모두 완료되었습니다.
            </p>
          ) : (
            pendingMigrations.map((block) => (
              <div key={block.key} className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-2">
                <p className="font-semibold text-[#191817]">{block.title}</p>
                <p className="text-[11px] text-[#57544e] leading-relaxed">{block.description}</p>
                <div className="flex items-center gap-2">
                  {block.onMigrate && (
                    <button
                      type="button"
                      onClick={block.onMigrate}
                      disabled={block.busy}
                      className="px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {block.busy ? '이전 중...' : block.actionLabel}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={block.onDecline}
                    disabled={block.busy}
                    className="px-3 py-1.5 border border-[#c8c2b5] bg-white text-[#57544e] rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                  >
                    {block.declineLabel ?? '나중에'}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="pt-3 border-t border-[#f1ede4] space-y-2.5">
          <h5 className="font-bold text-[#191817] flex items-center gap-1.5">
            <DatabaseBackup className="w-3.5 h-3.5" /> 자료 백업·복원
          </h5>
          <p className="text-[11px] text-[#57544e] leading-relaxed">
            현재 계정의 자료 메타데이터·로컬 본문·로컬 원본을 파일로 내보내거나 가져옵니다.
            학습 이력은 포함하지 않으며, API 키·토큰 같은 인증 정보도 포함하지 않습니다.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExport}
              disabled={exportBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{exportBusy ? '내보내는 중...' : '백업 내보내기'}</span>
            </button>
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              disabled={importBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-[#ded6c8] bg-white rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{importBusy ? '가져오는 중...' : '백업 가져오기'}</span>
            </button>
            <input
              ref={importInputRef}
              id="material-backup-file-input"
              data-testid="material-backup-file-input"
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-label="학습 자료 백업 파일 선택"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = '';
                if (file) void handleImportFile(file);
              }}
            />
          </div>

          {exportResult && (
            <div className={`p-2.5 border rounded-xs text-[11px] space-y-1 ${exportResult.complete ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-300 text-amber-900'}`} role="status">
              <p className="font-semibold">
                {exportResult.error
                  ? `백업 실패: ${exportResult.error}`
                  : exportResult.complete
                    ? `백업 완료: ${exportResult.withFiles}/${exportResult.total}건 (파일 포함)`
                    : `부분 백업: ${exportResult.withFiles}/${exportResult.total}건에 파일 포함 — 완전한 백업이 아닙니다`}
              </p>
              {exportResult.limitViolations && exportResult.limitViolations.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {exportResult.limitViolations.map((violation, index) => (
                    <li key={`${violation.id ?? 'backup'}-${index}`}>
                      {violation.title ? `${violation.title} (${violation.id})` : '백업 전체'} — {violation.reason}
                    </li>
                  ))}
                </ul>
              )}
              {exportResult.issues.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {exportResult.issues.map((issue) => (
                    <li key={`${issue.id}-${issue.which}`}>
                      {issue.which === 'body' ? '본문' : '원본'}{' '}
                      {issue.state === 'error' ? '읽기 실패' : '없음'}: {issue.title} ({issue.id})
                      {issue.message ? ` — ${issue.message}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {importError && (
            <p role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xs text-[11px]">
              {importError}
            </p>
          )}

          {pendingSubjectChoice && (
            <div className="p-2.5 bg-amber-50 border border-amber-300 rounded-xs text-[11px] space-y-2" role="group" aria-label="복원 대상 과목 선택">
              <p className="font-semibold text-amber-900">
                백업의 일부 과목이 이 계정에 없습니다. 해당 자료를 복원할 과목을 선택해 주세요.
              </p>
              {pendingSubjectChoice.unknownSubjectIds.map((subjectId) => (
                <div key={subjectId} className="flex flex-col gap-1">
                  <label htmlFor={`restore-subject-${subjectId}`} className="font-semibold text-[#191817]">
                    백업 과목 ID: {subjectId}
                  </label>
                  <select
                    id={`restore-subject-${subjectId}`}
                    value={pendingSubjectChoice.choices[subjectId] ?? subjects[0]?.id ?? ''}
                    onChange={(e) =>
                      setPendingSubjectChoice((prev) =>
                        prev ? { ...prev, choices: { ...prev.choices, [subjectId]: e.target.value } } : prev
                      )
                    }
                    className="w-full p-1.5 border border-[#ded6c8] rounded-xs bg-white text-[#191817]"
                  >
                    {subjects.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.code})
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={confirmSubjectChoice}
                  disabled={importBusy}
                  className="px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60"
                >
                  {importBusy ? '복원 중...' : '선택 완료 후 복원'}
                </button>
                <button
                  type="button"
                  onClick={() => setPendingSubjectChoice(null)}
                  disabled={importBusy}
                  className="px-3 py-1.5 border border-[#c8c2b5] bg-white text-[#57544e] rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                >
                  취소
                </button>
              </div>
            </div>
          )}

          {importResult && (
            <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-[11px] space-y-1" role="status">
              <p className="font-semibold text-[#191817]">
                복원 {importResult.restored.length}건 · 기존 유지 {importResult.skippedExisting.length}건
                {importResult.conflicts.length > 0 && ` · 충돌 ${importResult.conflicts.length}건(건너뜀)`}
                {importResult.failed.length > 0 && ` · 실패 ${importResult.failed.length}건`}
                {importResult.aborted && ' · 계정 변경으로 중단됨'}
              </p>
              {importResult.conflicts.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-amber-900">
                  {importResult.conflicts.map((c) => (
                    <li key={c.id}>충돌(덮어쓰지 않음): {c.title} — {c.reason}</li>
                  ))}
                </ul>
              )}
              {importResult.failed.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-red-800">
                  {importResult.failed.map((f) => (
                    <li key={f.id}>실패: {f.title} — {f.reason}</li>
                  ))}
                </ul>
              )}
              {importResult.missing.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5 text-[#57544e]">
                  {importResult.missing.map((m) => (
                    <li key={m.id}>
                      파일 연결 필요: {m.title} ({m.which.map((w) => WHICH_LABELS[w]).join('·')})
                    </li>
                  ))}
                </ul>
              )}
              {importResult.failed.length > 0 && (
                <p className="text-[#57544e]">같은 백업 파일로 다시 가져오면 성공한 항목은 건너뛰고 남은 항목만 이어서 복원합니다.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
