'use client';

import React, { useRef, useState } from 'react';
import { Database, Download, Upload, CheckCircle2, DatabaseBackup } from 'lucide-react';
import type { Material } from '../lib/types';
import {
  loadMaterialContent,
  loadMaterialOriginal,
  saveMaterialContent,
  saveMaterialOriginal,
} from '../lib/materialStorage';
import {
  MATERIAL_BACKUP_VERSION,
  backupContainsSecrets,
  base64ToBytes,
  buildMaterialBackup,
  parseMaterialBackup,
  planMaterialRestore,
  type MaterialBackupEntry,
} from '../lib/materialPolicy';
import { materialContentHash } from '../lib/cloud/hash';

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
  onRestoreMaterials: (restored: Material[]) => void;
}

interface ExportResult {
  total: number;
  withFiles: number;
  missing: Array<{ id: string; title: string }>;
  complete: boolean;
  error?: string;
}

interface ImportResult {
  restored: string[];
  skippedExisting: string[];
  conflicts: Array<{ id: string; title: string; reason: string }>;
  failed: Array<{ id: string; title: string; reason: string }>;
  missing: Array<{ id: string; title: string }>;
  error?: string;
}

export function DataManagementSection({ migrations, materials, onRestoreMaterials }: DataManagementSectionProps) {
  const [exportBusy, setExportBusy] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const pendingMigrations = migrations.filter((m) => m.pending);

  const handleExport = async () => {
    if (exportBusy) return;
    setExportBusy(true);
    setExportResult(null);
    try {
      const backup = await buildMaterialBackup(materials, {
        loadBody: async (id) => {
          const result = await loadMaterialContent(id);
          return result ? { markdown: result.markdown, rawText: result.rawText, pages: result.pages } : null;
        },
        loadOriginal: async (id) => {
          const result = await loadMaterialOriginal(id);
          if (result.status !== 'found') return null;
          return {
            contentType: result.contentType,
            hash: result.hash,
            data: new Uint8Array(await result.blob.arrayBuffer()),
          };
        },
      });
      const missing = backup.materials
        .filter((entry) => !entry.body && !entry.original)
        .map((entry) => ({ id: entry.material.id, title: entry.material.title }));
      const text = JSON.stringify(backup);
      const blob = new Blob([text], { type: 'application/json' });
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
        withFiles: backup.materials.length - missing.length,
        missing,
        complete: missing.length === 0,
      });
    } catch (error) {
      setExportResult({
        total: 0,
        withFiles: 0,
        missing: [],
        complete: false,
        error: error instanceof Error ? error.message : '백업 내보내기에 실패했습니다.',
      });
    } finally {
      setExportBusy(false);
    }
  };

  const executeRestore = async (entries: MaterialBackupEntry[]): Promise<void> => {
    const existing: Array<{ id: string; localBodyHash: string | null; localOriginalHash: string | null }> = [];
    for (const entry of entries) {
      let localBodyHash: string | null = null;
      let localOriginalHash: string | null = null;
      try {
        const body = await loadMaterialContent(entry.material.id);
        if (body) localBodyHash = materialContentHash({ markdown: body.markdown, rawText: body.rawText, pages: body.pages });
      } catch {
        localBodyHash = null;
      }
      try {
        const original = await loadMaterialOriginal(entry.material.id);
        if (original.status === 'found') localOriginalHash = original.hash;
      } catch {
        localOriginalHash = null;
      }
      existing.push({ id: entry.material.id, localBodyHash, localOriginalHash });
    }

    const plan = planMaterialRestore(entries, existing);
    const restored: string[] = [];
    const failed: Array<{ id: string; title: string; reason: string }> = [];
    const addedMetadata: Material[] = [];

    for (const id of plan.toRestore) {
      const entry = entries.find((e) => e.material.id === id);
      if (!entry) continue;
      try {
        if (entry.body) {
          const savedBody = await saveMaterialContent(id, {
            markdown: entry.body.markdown,
            rawText: entry.body.rawText,
            pages: entry.body.pages,
          });
          if (!savedBody.persisted) throw new Error(savedBody.error);
          const verifyBody = await loadMaterialContent(id);
          if (!verifyBody || materialContentHash({ markdown: verifyBody.markdown, rawText: verifyBody.rawText, pages: verifyBody.pages }) !== materialContentHash(entry.body)) {
            throw new Error('본문 읽기 검증에 실패했습니다.');
          }
        }
        if (entry.original) {
          const bytes = base64ToBytes(entry.original.base64);
          const blob = new Blob([bytes], { type: entry.original.contentType || 'application/pdf' });
          const savedOriginal = await saveMaterialOriginal(id, blob, entry.original.contentType || 'application/pdf');
          if (!savedOriginal.persisted) throw new Error(savedOriginal.error);
          const verifyOriginal = await loadMaterialOriginal(id);
          if (verifyOriginal.status !== 'found' || verifyOriginal.hash !== entry.original.hash) {
            throw new Error('원본 읽기 검증에 실패했습니다.');
          }
        }
        restored.push(id);
        if (!materials.some((m) => m.id === id)) addedMetadata.push(entry.material);
      } catch (error) {
        failed.push({ id, title: entry.material.title, reason: error instanceof Error ? error.message : '복원에 실패했습니다.' });
      }
    }

    if (addedMetadata.length > 0) onRestoreMaterials(addedMetadata);
    setImportResult({
      restored,
      skippedExisting: plan.alreadyPresent,
      conflicts: plan.conflicts,
      failed,
      missing: plan.missingFiles,
    });
  };

  const handleImportFile = async (file: File) => {
    if (importBusy) return;
    setImportBusy(true);
    setImportError('');
    setImportResult(null);
    try {
      const parsed = parseMaterialBackup(await file.text());
      if (!parsed.ok) {
        setImportError(parsed.error);
        return;
      }
      if (parsed.backup.version !== MATERIAL_BACKUP_VERSION) {
        setImportError(`지원하지 않는 백업 버전입니다 (지원: v${MATERIAL_BACKUP_VERSION}, 파일: v${parsed.backup.version}).`);
        return;
      }
      if (backupContainsSecrets(parsed.backup)) {
        setImportError('백업에 인증 정보가 포함되어 있어 가져오기를 중단했습니다.');
        return;
      }
      await executeRestore(parsed.backup.materials);
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
              type="file"
              accept="application/json,.json"
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
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
              {exportResult.missing.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {exportResult.missing.map((m) => (
                    <li key={m.id}>파일 없음: {m.title} ({m.id})</li>
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

          {importResult && (
            <div className="p-2.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs text-[11px] space-y-1" role="status">
              <p className="font-semibold text-[#191817]">
                복원 {importResult.restored.length}건 · 기존 유지 {importResult.skippedExisting.length}건
                {importResult.conflicts.length > 0 && ` · 충돌 ${importResult.conflicts.length}건(건너뜀)`}
                {importResult.failed.length > 0 && ` · 실패 ${importResult.failed.length}건`}
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
                    <li key={m.id}>파일 없음(메타데이터만): {m.title}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
