'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Database,
  Download,
  Upload,
  CheckCircle2,
  DatabaseBackup,
  Cloud,
  HardDrive,
  AlertTriangle,
  RotateCcw,
  Unlink,
  FileDown,
} from 'lucide-react';
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

export type BackupStage = 'idle' | 'preparing' | 'uploading' | 'success' | 'partial' | 'failed';

export interface BackupResultInfo {
  total: number;
  withFiles: number;
  issues: Array<{ id: string; title: string; which: 'body' | 'original'; state: 'absent' | 'error'; message?: string }>;
  complete: boolean;
  target: 'local' | 'drive';
  error?: string;
  errorCode?: string;
  limitViolations?: Array<{ id: string | null; title: string | null; reason: string }>;
  driveFileId?: string;
  driveFileName?: string;
  timestamp?: string;
  targetEmail?: string;
}

interface DriveConnectionState {
  loading: boolean;
  configured: boolean;
  connected: boolean;
  email: string | null;
  lastBackup: {
    timestamp: string;
    fileId: string;
    fileName: string;
    completeness: 'complete' | 'partial';
    totalMaterials: number;
    withFiles: number;
  } | null;
  notice?: {
    type: 'info' | 'error';
    message: string;
  };
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

interface CachedBackupData {
  backup: MaterialBackupFile;
  parts: BlobPart[];
  summary: ReturnType<typeof summarizeBackupCompleteness>;
  jobId: string;
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
  const [backupStage, setBackupStage] = useState<BackupStage>('idle');
  const [backupProgressMessage, setBackupProgressMessage] = useState('');
  const [backupResult, setBackupResult] = useState<BackupResultInfo | null>(null);
  const [cachedBackup, setCachedBackup] = useState<CachedBackupData | null>(null);

  const [driveState, setDriveState] = useState<DriveConnectionState>({
    loading: true,
    configured: false,
    connected: false,
    email: null,
    lastBackup: null,
  });

  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState('');
  const [pendingSubjectChoice, setPendingSubjectChoice] = useState<PendingSubjectChoice | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const pendingMigrations = migrations.filter((m) => m.pending);

  // Check Drive connection status & query parameters on load
  const refreshDriveStatus = async () => {
    try {
      const res = await fetch('/api/drive/status');
      if (!res.ok) {
        setDriveState((prev) => ({ ...prev, loading: false }));
        return;
      }
      const data = (await res.json()) as {
        configured: boolean;
        connected: boolean;
        email?: string;
        lastBackup?: DriveConnectionState['lastBackup'];
      };
      setDriveState((prev) => ({
        ...prev,
        loading: false,
        configured: data.configured,
        connected: data.connected,
        email: data.email || null,
        lastBackup: data.lastBackup || null,
      }));
    } catch {
      setDriveState((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshDriveStatus();

      // Check query params for OAuth result redirection
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href);
        const driveStatus = url.searchParams.get('drive_status');
        const driveError = url.searchParams.get('drive_error');

        if (driveStatus === 'connected') {
          setDriveState((prev) => ({
            ...prev,
            notice: { type: 'info', message: 'Google Drive 연결이 완료되었습니다.' },
          }));
          // Clean URL parameter without reloading
          url.searchParams.delete('drive_status');
          window.history.replaceState({}, '', url.toString());
        } else if (driveError) {
          let msg = 'Google Drive 연결에 실패했습니다.';
          if (driveError === 'cancelled') {
            msg = 'Google Drive 연결이 취소되었거나 권한이 거부되었습니다. 로컬 파일 백업은 상시 정상 사용하실 수 있습니다.';
          } else if (driveError === 'not_configured') {
            msg = 'Google Drive API 환경변수가 설정되지 않았습니다. 관리자 설정을 완료한 후 다시 시도해 주세요.';
          }
          setDriveState((prev) => ({
            ...prev,
            notice: { type: 'error', message: msg },
          }));
          url.searchParams.delete('drive_error');
          window.history.replaceState({}, '', url.toString());
        }
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  const handleDisconnectDrive = async () => {
    try {
      await fetch('/api/drive/disconnect', { method: 'POST' });
      setDriveState((prev) => ({
        ...prev,
        connected: false,
        email: null,
        notice: { type: 'info', message: 'Google Drive 연결이 해제되었습니다. 저장된 드라이브 백업 파일은 보존됩니다.' },
      }));
    } catch {
      // ignore
    }
  };

  /**
   * Generates and validates backup data once in memory.
   */
  const generateBackupData = async (): Promise<CachedBackupData | null> => {
    setBackupStage('preparing');
    setBackupProgressMessage('자료 데이터 수집 및 형식 검증 중...');

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
    const parts = materialBackupBlobParts(backup);
    const serializedSize = measureMaterialBackupPartsSize(parts);
    const limitViolations = findBackupLimitViolations(backup, MATERIAL_BACKUP_LIMITS, serializedSize);

    if (limitViolations.length > 0) {
      setBackupStage('failed');
      setBackupResult({
        total: backup.materials.length,
        withFiles: 0,
        issues: summary.issues,
        complete: false,
        target: 'local',
        error: `백업 파일이 처리 가능한 크기를 초과해 중단했습니다. ${limitViolations.map((v) => v.reason).join(' ')}`,
        limitViolations,
      });
      return null;
    }

    if (backupContainsSecrets(backup)) {
      setBackupStage('failed');
      setBackupResult({
        total: backup.materials.length,
        withFiles: 0,
        issues: summary.issues,
        complete: false,
        target: 'local',
        error: '백업에 인증 정보로 보이는 필드가 포함되어 있어 중단했습니다.',
      });
      return null;
    }

    const jobId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `job_${Date.now()}`;
    const cached: CachedBackupData = { backup, parts, summary, jobId };
    setCachedBackup(cached);
    return cached;
  };

  /**
   * Triggers local download of backup parts.
   */
  const triggerLocalDownload = (cached: CachedBackupData) => {
    const blob = new Blob(cached.parts, { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    anchor.href = url;
    anchor.download = `learnaway-materials-backup-${stamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    const isComplete = cached.summary.complete;
    setBackupStage(isComplete ? 'success' : 'partial');
    setBackupResult({
      total: cached.backup.materials.length,
      withFiles: cached.backup.materials.length - cached.summary.materialsWithIssues,
      issues: cached.summary.issues,
      complete: isComplete,
      target: 'local',
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * Action: 이 기기에 파일로 저장 (Local file download)
   */
  const handleLocalBackup = async () => {
    if (backupStage === 'preparing' || backupStage === 'uploading') return;
    setBackupResult(null);

    try {
      const cached = await generateBackupData();
      if (!cached) return;
      triggerLocalDownload(cached);
    } catch (error) {
      setBackupStage('failed');
      setBackupResult({
        total: 0,
        withFiles: 0,
        issues: [],
        complete: false,
        target: 'local',
        error: error instanceof Error ? error.message : '로컬 백업 생성에 실패했습니다.',
      });
    }
  };

  /**
   * Action: Google Drive에 저장 (Drive upload)
   */
  const handleDriveBackup = async (cachedToUse?: CachedBackupData) => {
    if (backupStage === 'preparing' || backupStage === 'uploading') return;
    setBackupResult(null);

    try {
      const cached = cachedToUse || (await generateBackupData());
      if (!cached) return;

      setBackupStage('uploading');
      setBackupProgressMessage('Google Drive 백업 폴더로 안전하게 업로드 중...');

      const completeness = cached.summary.complete ? 'complete' : 'partial';
      const backupBlob = new Blob(cached.parts, { type: 'application/json' });
      const totalBytes = backupBlob.size;
      const totalMaterials = cached.backup.materials.length;
      const withFiles = totalMaterials - cached.summary.materialsWithIssues;

      // 1. Initialize resumable session
      const initRes = await fetch('/api/drive/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'init',
          jobId: cached.jobId,
          completeness,
          totalBytes,
          totalMaterials,
          withFiles,
        }),
      });

      const initData = (await initRes.json()) as {
        ok: boolean;
        existing?: boolean;
        complete?: boolean;
        fileId?: string;
        fileName?: string;
        timestamp?: string;
        sessionToken?: string;
        chunkSize?: number;
        error?: { code: string; message: string };
      };

      if (!initRes.ok || !initData.ok) {
        setBackupStage('failed');
        setBackupResult({
          total: totalMaterials,
          withFiles,
          issues: cached.summary.issues,
          complete: false,
          target: 'drive',
          errorCode: initData.error?.code || 'UNKNOWN_ERROR',
          error: initData.error?.message || 'Google Drive 업로드 세션 생성에 실패했습니다.',
          targetEmail: driveState.email || undefined,
        });
        return;
      }

      // If existing completed backup was found (idempotency guard)
      if (initData.existing && initData.fileId) {
        const isComplete = cached.summary.complete;
        setBackupStage(isComplete ? 'success' : 'partial');
        setBackupResult({
          total: totalMaterials,
          withFiles,
          issues: cached.summary.issues,
          complete: isComplete,
          target: 'drive',
          driveFileId: initData.fileId,
          driveFileName: initData.fileName,
          timestamp: initData.timestamp || new Date().toISOString(),
          targetEmail: driveState.email || undefined,
        });
        return;
      }

      const sessionToken = initData.sessionToken;
      const chunkSize = initData.chunkSize || 2 * 1024 * 1024;
      if (!sessionToken) {
        throw new Error('업로드 세션 토큰을 발급받지 못했습니다.');
      }

      // 2. Stream chunks under serverless size limit
      let offset = 0;
      let finalFileId = '';
      let finalFileName = '';
      let finalTimestamp = '';

      while (offset < totalBytes) {
        const end = Math.min(offset + chunkSize, totalBytes) - 1;
        const chunkBlob = backupBlob.slice(offset, end + 1);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const pct = Math.round(((end + 1) / totalBytes) * 100);
        setBackupProgressMessage(`Google Drive 백업 업로드 중... (${pct}%)`);

        const chunkRes = await fetch('/api/drive/upload', {
          method: 'POST',
          headers: {
            'x-upload-session': sessionToken,
            'Content-Range': `bytes ${offset}-${end}/${totalBytes}`,
            'Content-Type': 'application/octet-stream',
          },
          body: chunkBuffer,
        });

        const chunkData = (await chunkRes.json()) as {
          ok: boolean;
          complete?: boolean;
          fileId?: string;
          fileName?: string;
          timestamp?: string;
          error?: { code: string; message: string };
        };

        if (!chunkRes.ok || !chunkData.ok) {
          throw new Error(chunkData.error?.message || '청크 업로드 처리 중 오류가 발생했습니다.');
        }

        if (chunkData.complete && chunkData.fileId) {
          finalFileId = chunkData.fileId;
          finalFileName = chunkData.fileName || '';
          finalTimestamp = chunkData.timestamp || new Date().toISOString();
          break;
        }

        offset = end + 1;
      }

      if (!finalFileId) {
        throw new Error('Google Drive 업로드 완료 확인을 받지 못했습니다.');
      }

      // 3. Mark success ONLY after server confirmed completion
      const isComplete = cached.summary.complete;
      setBackupStage(isComplete ? 'success' : 'partial');
      setBackupResult({
        total: totalMaterials,
        withFiles,
        issues: cached.summary.issues,
        complete: isComplete,
        target: 'drive',
        driveFileId: finalFileId,
        driveFileName: finalFileName,
        timestamp: finalTimestamp,
        targetEmail: driveState.email || undefined,
      });

      setDriveState((prev) => ({
        ...prev,
        lastBackup: {
          timestamp: finalTimestamp,
          fileId: finalFileId,
          fileName: finalFileName,
          completeness,
          totalMaterials,
          withFiles,
        },
      }));
    } catch (error) {
      setBackupStage('failed');
      setBackupResult({
        total: cachedToUse ? cachedToUse.backup.materials.length : 0,
        withFiles: 0,
        issues: [],
        complete: false,
        target: 'drive',
        errorCode: 'NETWORK_ERROR',
        error: error instanceof Error ? error.message : '네트워크 오류가 발생했습니다.',
        targetEmail: driveState.email || undefined,
      });
    }
  };

  /**
   * Action: Drive 실패 후 생성된 백업 데이터를 로컬 파일로 즉시 다운로드 (재생성 없음)
   */
  const handleDownloadCachedBackup = () => {
    if (!cachedBackup) return;
    triggerLocalDownload(cachedBackup);
  };

  /**
   * Action: Drive 업로드 재시도 (재생성 없이 동일 캐시 사용)
   */
  const handleRetryDriveUpload = () => {
    if (!cachedBackup) {
      void handleDriveBackup();
    } else {
      void handleDriveBackup(cachedBackup);
    }
  };

  const runRestore = async (
    backup: MaterialBackupFile,
    subjectOverride?: Record<string, string>
  ): Promise<Awaited<ReturnType<typeof executeMaterialRestore>>> => {
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
    const knownSubjectIds = new Set(subjects.map((s) => s.id));
    const unresolved = pendingSubjectChoice.unknownSubjectIds.filter((sourceSubjectId) => {
      const target = pendingSubjectChoice.choices[sourceSubjectId];
      return !target || !knownSubjectIds.has(target);
    });
    if (unresolved.length > 0) {
      setImportError('선택한 대상 과목을 현재 계정에서 찾을 수 없습니다. 대상 과목을 다시 선택해 주세요.');
      return;
    }
    setImportBusy(true);
    setImportError('');
    try {
      const outcome = await runRestore(pendingSubjectChoice.backup, pendingSubjectChoice.choices);
      if (outcome.blockedBySubject) {
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
        {/* 클라우드 이관 영역 */}
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

        {/* 자료 백업·복원 영역 */}
        <div className="pt-3 border-t border-[#f1ede4] space-y-3">
          <h5 className="font-bold text-[#191817] flex items-center gap-1.5">
            <DatabaseBackup className="w-3.5 h-3.5" /> 자료 백업·복원
          </h5>
          <p className="text-[11px] text-[#57544e] leading-relaxed">
            현재 계정의 자료 메타데이터·로컬 본문·로컬 원본을 파일로 내보내거나 가져옵니다.
            학습 이력은 포함하지 않으며, API 키·토큰 같은 인증 정보도 포함하지 않습니다.
            브라우저 내부 IndexedDB 보관과 별개로, 디스크 파일 저장이나 Google Drive 백업을 통해 브라우저 캐시 초기화에도 안전하게 보관할 수 있습니다.
          </p>

          {/* Drive 상태 알림 배너 */}
          {driveState.notice && (
            <div
              className={`p-2.5 rounded-xs text-[11px] flex items-start justify-between gap-2 border ${
                driveState.notice.type === 'info'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-300 text-amber-900'
              }`}
            >
              <span>{driveState.notice.message}</span>
              <button
                type="button"
                onClick={() => setDriveState((prev) => ({ ...prev, notice: undefined }))}
                className="text-xs font-bold hover:underline"
              >
                닫기
              </button>
            </div>
          )}

          {/* 백업 만들기 컨트롤 박스 */}
          <div className="p-3 bg-[#faf8f4] border border-[#ded6c8] rounded-xs space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-bold text-[#191817] text-xs">[백업 만들기]</span>
              <span className="text-[11px] text-[#827d73]">
                {backupStage === 'preparing' || backupStage === 'uploading' ? (
                  <span className="text-[#c52828] font-semibold animate-pulse">{backupProgressMessage}</span>
                ) : (
                  '원하는 백업 방식을 선택하세요'
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* 로컬 파일 백업 (이 기기에 파일로 저장) - 언제나 사용 가능 */}
              <div className="p-3 bg-white border border-[#ded6c8] rounded-xs space-y-2 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-[#191817]">
                    <HardDrive className="w-3.5 h-3.5 text-[#57544e]" />
                    <span>이 기기에 파일로 저장</span>
                  </div>
                  <p className="text-[11px] text-[#57544e] leading-relaxed">
                    Google Drive 연결 여부와 상관없이 즉시 내 컴퓨터에 JSON 파일로 다운로드합니다.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleLocalBackup}
                  disabled={backupStage === 'preparing' || backupStage === 'uploading'}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#191817] text-white font-bold rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60 text-xs"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>
                    {backupStage === 'preparing' && backupResult?.target === 'local'
                      ? '준비 중...'
                      : '이 기기에 파일로 저장'}
                  </span>
                </button>
              </div>

              {/* Google Drive 백업 */}
              <div className="p-3 bg-white border border-[#ded6c8] rounded-xs space-y-2 flex flex-col justify-between">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-bold text-[#191817]">
                      <Cloud className="w-3.5 h-3.5 text-[#2563eb]" />
                      <span>Google Drive에 저장</span>
                    </div>
                    {driveState.connected && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded-xs font-semibold">
                        연결됨
                      </span>
                    )}
                  </div>

                  {!driveState.configured ? (
                    <p className="text-[11px] text-amber-800 leading-relaxed">
                      Google Drive API 환경변수(GOOGLE_DRIVE_CLIENT_ID 등)가 서버에 설정되지 않았습니다.
                      관리자 설정을 마친 후 연결할 수 있습니다. (로컬 백업은 상시 정상 이용 가능)
                    </p>
                  ) : !driveState.connected ? (
                    <p className="text-[11px] text-[#57544e] leading-relaxed">
                      Google Drive를 연결하면 클라우드 전용 폴더에 안전하게 백업을 보관할 수 있습니다.
                      연결을 취소하거나 권한을 거부해도 로컬 백업은 계속 가능합니다.
                    </p>
                  ) : (
                    <div className="text-[11px] space-y-0.5">
                      <p className="font-semibold text-emerald-800">
                        연결된 계정: {driveState.email}
                      </p>
                      {driveState.lastBackup && (
                        <p className="text-[10px] text-[#827d73]">
                          최근 백업: {new Date(driveState.lastBackup.timestamp).toLocaleString('ko-KR')} (
                          {driveState.lastBackup.completeness === 'complete' ? '완전 백업' : '부분 백업'})
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {driveState.configured ? (
                  !driveState.connected ? (
                    <a
                      href="/api/drive/auth"
                      className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 border border-[#2563eb] bg-white text-[#2563eb] font-bold rounded-xs hover:bg-blue-50 transition-colors text-xs text-center"
                    >
                      <Cloud className="w-3.5 h-3.5" />
                      <span>Google Drive 연결</span>
                    </a>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleDriveBackup()}
                        disabled={backupStage === 'preparing' || backupStage === 'uploading'}
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-[#2563eb] text-white font-bold rounded-xs hover:bg-[#1d4ed8] transition-colors disabled:opacity-60 text-xs"
                      >
                        <Cloud className="w-3.5 h-3.5" />
                        <span>
                          {backupStage === 'uploading'
                            ? '업로드 중...'
                            : backupStage === 'preparing' && backupResult?.target === 'drive'
                            ? '준비 중...'
                            : 'Google Drive에 백업'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={handleDisconnectDrive}
                        title="Google Drive 연결 해제"
                        className="px-2 py-1.5 border border-[#ded6c8] bg-white text-[#57544e] rounded-xs hover:bg-[#faf8f4] text-xs flex items-center gap-1"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">해제</span>
                      </button>
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    disabled
                    className="w-full px-3 py-1.5 border border-[#ded6c8] bg-gray-100 text-[#827d73] rounded-xs text-xs cursor-not-allowed text-center"
                  >
                    API 환경변수 설정 필요
                  </button>
                )}
              </div>
            </div>

            <p className="text-[10px] text-[#827d73] leading-relaxed">
              * LearnAway에 Google 계정으로 로그인한 상태라도 Google Drive 백업 권한(drive.file)은 별도 승인이 필요합니다.
              드라이브 백업 파일은 앱 전용 폴더에만 저장되며 외부에 공개 공유되지 않습니다.
            </p>
          </div>

          {/* 백업 결과 상태 표시 영역 */}
          {backupResult && (
            <div
              className={`p-3 border rounded-xs text-[11px] space-y-2 ${
                backupResult.complete
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : backupStage === 'partial'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-red-50 border-red-200 text-red-900'
              }`}
              role="status"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold flex items-center gap-1.5">
                  {backupResult.complete ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : backupStage === 'partial' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-red-600" />
                  )}
                  <span>
                    {backupStage === 'failed'
                      ? `백업 실패: ${backupResult.error}`
                      : backupResult.complete
                      ? `백업 성공 (${backupResult.target === 'drive' ? 'Google Drive' : '이 기기'}): ${backupResult.withFiles}/${backupResult.total}건 파일 포함`
                      : `부분 백업 (${backupResult.target === 'drive' ? 'Google Drive' : '이 기기'}): ${backupResult.withFiles}/${backupResult.total}건에 파일 포함 — 완전한 백업이 아닙니다`}
                  </span>
                </div>
                <span className="text-[10px] text-[#57544e]">
                  {backupResult.target === 'drive' && backupResult.targetEmail
                    ? `대상: ${backupResult.targetEmail}`
                    : backupResult.target === 'local'
                    ? '로컬 파일'
                    : ''}
                </span>
              </div>

              {/* 안내 문구: 디스크 저장 완료 단정 방지 */}
              {backupResult.target === 'local' && backupStage !== 'failed' && (
                <p className="text-[10px] text-emerald-800 bg-emerald-100/50 p-1.5 rounded-xs">
                  브라우저의 파일 다운로드를 시작했습니다. 브라우저 다운로드 창에서 저장을 완료해 주세요.
                </p>
              )}

              {/* Drive 업로드 성공 시 파일명 표시 */}
              {backupResult.target === 'drive' && backupResult.driveFileName && (
                <p className="text-[10px] text-emerald-800">
                  드라이브 파일명: <span className="font-mono">{backupResult.driveFileName}</span> (LearnAway Backups 폴더)
                </p>
              )}

              {/* 용량 초과 등 제한 위반 안내 */}
              {backupResult.limitViolations && backupResult.limitViolations.length > 0 && (
                <ul className="list-disc pl-4 space-y-0.5">
                  {backupResult.limitViolations.map((violation, index) => (
                    <li key={`${violation.id ?? 'backup'}-${index}`}>
                      {violation.title ? `${violation.title} (${violation.id})` : '백업 전체'} — {violation.reason}
                    </li>
                  ))}
                </ul>
              )}

              {/* 누락되거나 오류가 발생한 자료 목록 (부분 백업의 이유) */}
              {backupResult.issues.length > 0 && (
                <div className="space-y-1">
                  <p className="font-semibold text-amber-900">제외되거나 누락된 항목:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {backupResult.issues.map((issue) => (
                      <li key={`${issue.id}-${issue.which}`}>
                        {issue.which === 'body' ? '본문' : '원본'}{' '}
                        {issue.state === 'error' ? '읽기 실패' : '없음'}: {issue.title} ({issue.id})
                        {issue.message ? ` — ${issue.message}` : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Drive 업로드 실패 시 제공되는 선택지 */}
              {backupStage === 'failed' && backupResult.target === 'drive' && (
                <div className="pt-2 border-t border-red-200 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleRetryDriveUpload}
                    className="flex items-center gap-1 px-2.5 py-1 bg-white border border-red-300 text-red-900 font-semibold rounded-xs hover:bg-red-50 text-xs"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>다시 시도</span>
                  </button>
                  {cachedBackup && (
                    <button
                      type="button"
                      onClick={handleDownloadCachedBackup}
                      className="flex items-center gap-1 px-2.5 py-1 bg-[#191817] text-white font-semibold rounded-xs hover:bg-[#33302b] text-xs"
                    >
                      <FileDown className="w-3 h-3" />
                      <span>이 백업을 로컬 파일로 다운로드</span>
                    </button>
                  )}
                  {(backupResult.errorCode === 'AUTH_EXPIRED' || backupResult.errorCode === 'PERMISSION_DENIED') && (
                    <a
                      href="/api/drive/auth"
                      className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 text-white font-semibold rounded-xs hover:bg-blue-700 text-xs"
                    >
                      <Cloud className="w-3 h-3" />
                      <span>Google 계정 다시 연결</span>
                    </a>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 백업 가져오기 (복원) 영역 */}
          <div className="pt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-t border-[#f1ede4]">
            <div className="space-y-0.5">
              <span className="font-bold text-[#191817] text-xs">백업 파일 복원 (가져오기)</span>
              <p className="text-[11px] text-[#57544e]">
                로컬 백업 파일 또는 Google Drive에서 다운로드한 백업 파일을 선택하여 복원합니다.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                disabled={importBusy}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[#ded6c8] bg-white rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60 text-xs font-semibold"
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
          </div>

          {importError && (
            <p role="alert" className="p-2.5 bg-red-50 border border-red-200 text-red-800 rounded-xs text-[11px]">
              {importError}
            </p>
          )}

          {pendingSubjectChoice && (
            <div
              className="p-2.5 bg-amber-50 border border-amber-300 rounded-xs text-[11px] space-y-2"
              role="group"
              aria-label="복원 대상 과목 선택"
            >
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
                <p className="text-[#57544e]">
                  같은 백업 파일로 다시 가져오면 성공한 항목은 건너뛰고 남은 항목만 이어서 복원합니다.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
