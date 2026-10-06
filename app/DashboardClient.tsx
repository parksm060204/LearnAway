'use client';

import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  Subject,
  Material,
  MaterialPage,
  Concept,
  ConceptDraft,
  Problem,
  ProblemDraft,
  Attempt,
  ProblemType,
  RetentionModelSettings,
  ProblemQualityStatus,
  ProblemReportType,
  isProblemAvailableForPractice,
  StudyPlanSettings,
  StudyPlanItem,
  DEFAULT_STUDY_PLAN_SETTINGS,
  MockExamSession,
  PersonalizationSettings,
  DEFAULT_PERSONALIZATION_SETTINGS,
  RechallengeReservation,
} from '../lib/types';
import { INITIAL_MATERIALS } from '../lib/initialData';
import {
  loadStoredSubjects,
  saveStoredSubjects,
  loadActiveSubjectId,
  saveActiveSubjectId,
  loadStoredMaterials,
  saveStoredMaterials,
  saveStoredMaterialsVerified,
  migrateStoredMaterialBodies,
  loadStoredConcepts,
  saveStoredConcepts,
  loadStoredConceptDrafts,
  saveStoredConceptDrafts,
  loadStoredProblems,
  saveStoredProblems,
  loadStoredProblemDrafts,
  saveStoredProblemDrafts,
  updateProblemDraft,
  loadStoredAttempts,
  saveStoredAttempts,
  loadStoredSettings,
  saveStoredSettings,
  recordAttemptAndUpdateConcept,
  recordAssistedRevisionAttempt,
  resetToInitialDemoData,
  postponeConceptReview,
  reportProblemError,
  updateProblemQualityStatus,
  dismissProblemReport,
  editAndReviseProblem,
  reapproveProblem,
  suspendProblem,
  loadStoredStudyPlanSettings,
  saveStoredStudyPlanSettings,
  loadStoredStudyPlanItems,
  saveStoredStudyPlanItems,
  postponeStudyPlanItem,
  skipStudyPlanItem,
  loadStoredPersonalizationSettings,
  saveStoredPersonalizationSettings,
  saveStoredPersonalizationState,
  checkStoredDataIntegrity,
  buildProblemFromDraft,
  AttemptSaveStatus,
} from '../lib/storage';
import { loadLearningLibrary } from '../lib/cloud/learningLibrary';
import { mergeConcepts, mergeDrafts, mergeProblems } from '../lib/cloud/mergeLearning';
import {
  approveConceptDraft as approveConceptDraftCloud,
  approveProblemDraft as approveProblemDraftCloud,
  getConceptById,
  getConceptDraftById,
  getProblemById,
  getProblemDraftById,
  deleteProblemDraft as deleteProblemDraftCloud,
  updateProblemDraft as updateProblemDraftCloud,
  deleteConceptDraft as deleteConceptDraftCloud,
  updateConceptDraft as updateConceptDraftCloud,
  updateProblemQuality,
  reviseProblem,
} from '../lib/cloud/learningRepository';
import { buildConceptFromDraft } from '../lib/learningApproval';
import {
  ensureLearningOriginals,
  loadLearningOriginals,
  getMigratedIds,
  markLearningServerCache,
} from '../lib/cloud/learningOriginals';
import {
  listAttempts,
  listReviewEvents,
  listStudyPlanItems,
  getStudyPlanSettings,
  listMockExamSessions,
  createStudyPlanItems,
  saveStudyPlanItem,
  submitAttempt as submitAttemptCloud,
  upsertStudyPlanSettings,
} from '../lib/cloud/historyRepository';
import { mergeById as mergeHistoryById, mergeEventsIntoConcepts } from '../lib/cloud/historyMerge';
import {
  getHistoryMigrationState,
  migrateLocalHistoryToCloud,
  declineHistoryMigration,
  HistoryMigrationState,
} from '../lib/cloud/historyMigration';
import {
  DEFAULT_RETENTION_SETTINGS,
  rankConceptsForReview,
} from '../lib/retentionModel';
import { generateStudyPlan } from '../lib/studyPlan';
import { computeCorrectionState, getEffectiveIntervalMultiplier } from '../lib/personalization';
import { loadMockExams, saveMockExam } from '../lib/mockExam';
import {
  loadRechallengeReservations,
  saveRechallengeReservation,
  updateRechallengeReservation,
  completeRechallengeReservation,
  cancelRechallengeReservation,
  getRechallengeReservation,
  handleReservationCompletionOutcome,
} from '../lib/logicSession';
import { LearningAnalyticsModal } from '../components/LearningAnalyticsModal';
import { LogicStrengthenModal } from '../components/LogicStrengthenModal';
import { TopUtilityBar, type DashboardTab } from '../components/TopUtilityBar';
import {
  parseDashboardUrl,
  buildDashboardUrl,
  resolveDashboardUrl,
  type NotFoundEntityKind,
} from '../lib/dashboardUrl';
import { resolveSessionAffiliation } from '../lib/sessionAffiliation';
import { TodayWorkspace } from '../components/TodayWorkspace';
import { MaterialsWorkspace } from '../components/MaterialsWorkspace';
import { ProblemsWorkspace } from '../components/ProblemsWorkspace';
import { HistoryWorkspace } from '../components/HistoryWorkspace';
import { SettingsWorkspace } from '../components/SettingsWorkspace';
import { type SortMode } from '../components/ConceptRail';
import { type MigrationUiBlock } from '../components/DataManagementSection';
import { ProblemSessionModal } from '../components/ProblemSessionModal';
import { ExamScheduleModal } from '../components/ExamScheduleModal';
import { ScopeManageModal } from '../components/ScopeManageModal';
import { MaterialUploadModal } from '../components/MaterialUploadModal';
import { MaterialEditorModal } from '../components/MaterialEditorModal';
import { MaterialsListModal } from '../components/MaterialsListModal';
import { ConceptReviewModal } from '../components/ConceptReviewModal';
import { ProblemGeneratorModal } from '../components/ProblemGeneratorModal';
import { ProblemReviewModal } from '../components/ProblemReviewModal';
import { PdfViewerModal } from '../components/PdfViewerModal';
import { SettingsModal } from '../components/SettingsModal';
import { MockExamModal, MockExamInitialConfig } from '../components/MockExamModal';
import { AddSubjectModal } from '../components/AddSubjectModal';
import { StudyPlanModal } from '../components/StudyPlanModal';
import { calculateDDay, toSeoulDateString, addDaysToDate } from '../lib/dateUtils';
import { getTodayPendingItems, resolvePrimaryCta } from '../lib/todayStudy';
import {
  clearAllMaterialContent,
  deleteMaterialContent,
  deleteMaterialOriginal,
  loadMaterialContentResult,
  loadMaterialContent,
  loadMaterialContentInScope,
  loadMaterialOriginalInScope,
  saveMaterialContent,
  saveMaterialContentInScope,
  saveMaterialOriginalInScope,
  saveMaterialOriginal,
  hashBlob,
} from '../lib/materialStorage';
import { computeMarkdownHash } from '../lib/markdownUtils';
import {
  recordMaterialBodyHash,
  resolveStoredMaterialBodyHash,
  removeStoredMaterialBodyHash,
  markMaterialDeleted,
  markMaterialLocalOnly,
  clearDeletedMaterialMarker,
  clearLocalOnlyMaterialMarker,
  isLocalOnlyMaterial,
  reconcileDeletedMaterialMarkers,
  saveStoredMaterialsFromServerCache,
  recordMaterialSyncState,
  getMaterialServerSaveRecord,
  recordMaterialServerSave,
  type MaterialHashIdentity,
} from '../lib/storage';
import { loadDefaultMaterialPolicy, materialPolicyOf } from '../lib/materialPolicy';
import { materialContentHash } from '../lib/cloud/hash';
import {
  evaluateMaterialServerRetry,
  type MaterialServerSaveResult,
} from '../lib/materialEditSave';
import { loadCloudLibrary } from '../lib/cloud/library';
import { upsertSubject } from '../lib/cloud/subjectsRepository';
import {
  createMaterialSignedUrl,
  deleteMaterial,
  getMaterialServerBodyHash,
  writeMaterial,
  writeMaterialMetadata,
} from '../lib/cloud/materialsRepository';
import {
  getCloudMigrationState,
  migrateLocalLibraryToCloud,
  declineCloudMigration,
  CloudMigrationState,
} from '../lib/cloud/localMigration';
import {
  ensureMigrationOriginals,
  hasServerCache,
  markServerCache,
} from '../lib/cloud/migrationOriginals';
import {
  getLearningMigrationState,
  migrateLocalLearningToCloud,
  declineLearningMigration,
  LearningMigrationState,
} from '../lib/cloud/learningMigration';
import { applyMaterialEditToProblems } from '../lib/problemFreshness';
import { setStorageScope, getStorageScopeId } from '../lib/storageScope';
import {
  getLegacyImportState,
  importLegacyData,
  declineLegacyImport,
  LegacyImportState,
} from '../lib/legacyImport';
import { createClient as createBrowserSupabaseClient } from '../lib/supabase/client';
import { isSupabaseConfigured } from '../lib/supabase/config';
import type { AppUser } from '../lib/auth/types';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { reportAppReady, reportAppError } from '../lib/appReadiness';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

// Stable no-op subscription used only to detect client hydration.
const hydrationSubscribe = () => () => {};

export default function LearnMyWayDashboardPage({ currentUser }: { currentUser: AppUser }) {
  // Bind every local read/write to this account before any storage-backed state
  // initializer runs. This is what keeps another account's records out of view.
  useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      setStorageScope({ kind: 'user', userId: currentUser.id });
    }
    return true;
  });

  // Hydration safety flag
  const [isLoaded, setIsLoaded] = useState(false);
  // Corrupt stored records (not an empty account). Surfaces an error + retry.
  const [loadError, setLoadError] = useState<string[] | null>(null);

  // Core Data State
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [activeSubjectId, setActiveSubjectId] = useState<string>('');
  const [materials, setMaterials] = useState<Material[]>([]);
  const [allConcepts, setAllConcepts] = useState<Concept[]>([]);
  const [allProblems, setAllProblems] = useState<Problem[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [settings, setSettings] = useState<RetentionModelSettings>(DEFAULT_RETENTION_SETTINGS);

  // Interaction State
  const [activeTab, setActiveTab] = useState<DashboardTab>('today');
  const [selectedConceptId, setSelectedConceptId] = useState<string>('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedProblemType, setSelectedProblemType] = useState<ProblemType>('essay_descriptive');
  const [sortMode, setSortMode] = useState<SortMode>('vulnerability');

  // Comparison Mode State (up to 3 concepts)
  const [isComparisonMode, setIsComparisonMode] = useState<boolean>(false);
  const [comparedConceptIds, setComparedConceptIds] = useState<string[]>([]);

  // Modals Visibility
  const [isAddSubjectModalOpen, setIsAddSubjectModalOpen] = useState(false);
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isScopeModalOpen, setIsScopeModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isProblemSessionOpen, setIsProblemSessionOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [aiConnectionMissing, setAiConnectionMissing] = useState(false);
  const [isMockExamModalOpen, setIsMockExamModalOpen] = useState(false);
  const [mockExamInitialConfig, setMockExamInitialConfig] = useState<MockExamInitialConfig | null>(null);
  const [isMaterialsListOpen, setIsMaterialsListOpen] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [isMaterialEditorOpen, setIsMaterialEditorOpen] = useState(false);
  const [pdfViewerSourceRef, setPdfViewerSourceRef] = useState<string | null>(null);

  // Stage 2: AI Concept Extraction & Review State
  const [conceptDrafts, setConceptDrafts] = useState<ConceptDraft[]>([]);
  const [isConceptReviewOpen, setIsConceptReviewOpen] = useState(false);
  const [conceptReviewMaterial, setConceptReviewMaterial] = useState<Material | null>(null);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);

  // Stage 3: AI Problem Generation & Review State
  const [problemDrafts, setProblemDrafts] = useState<ProblemDraft[]>([]);
  const [isProblemGeneratorOpen, setIsProblemGeneratorOpen] = useState(false);
  const [isProblemReviewOpen, setIsProblemReviewOpen] = useState(false);
  const [activeProblemIdForSession, setActiveProblemIdForSession] = useState<string | null>(null);

  // Stage 9: Study Plan State
  const [studyPlanSettings, setStudyPlanSettings] = useState<StudyPlanSettings>(DEFAULT_STUDY_PLAN_SETTINGS);
  const [studyPlanItems, setStudyPlanItems] = useState<StudyPlanItem[]>([]);
  const [isStudyPlanOpen, setIsStudyPlanOpen] = useState(false);

  // Stage 10: Learning Analytics & Personalization State
  const [mockExams, setMockExams] = useState<MockExamSession[]>([]);
  const [personalizationSettings, setPersonalizationSettings] = useState<PersonalizationSettings>(DEFAULT_PERSONALIZATION_SETTINGS);
  const [isLearningAnalyticsOpen, setIsLearningAnalyticsOpen] = useState(false);

  // Stage 13: Answer-logic strengthening session & delayed rechallenge
  const [logicTarget, setLogicTarget] = useState<{ attempt: Attempt; concept: Concept; problem: Problem } | null>(null);
  const [logicRecommendationDate, setLogicRecommendationDate] = useState<string | null>(null);
  const [rechallengeReservations, setRechallengeReservations] = useState<RechallengeReservation[]>([]);
  const [activeRechallengeReservationId, setActiveRechallengeReservationId] = useState<string | null>(null);
  const [activePlanItemIdForSession, setActivePlanItemIdForSession] = useState<string | null>(null);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
  // An explicit exam id from the URL (?tab=exam&exam=Y). Opens that exact exam
  // read-only when needed; cleared when the exam screen is opened from a menu.
  const [examIdFromUrl, setExamIdFromUrl] = useState<string | null>(null);
  const [urlNotice, setUrlNotice] = useState<{
    message: string;
    entity?: { kind: NotFoundEntityKind; id: string };
  } | null>(null);

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3800);
  };

  // Session / account switching
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [legacyImportState, setLegacyImportState] = useState<LegacyImportState | null>(null);
  const [isImportingLegacy, setIsImportingLegacy] = useState(false);
  // Cloud library (subjects + materials) is the source of truth for this stage.
  const [cloudStatus, setCloudStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudReloadToken, setCloudReloadToken] = useState(0);
  const [cloudMigrationState, setCloudMigrationState] = useState<CloudMigrationState | null>(null);
  const [isMigratingCloud, setIsMigratingCloud] = useState(false);
  const [learningMigrationState, setLearningMigrationState] = useState<LearningMigrationState | null>(null);
  const [historyMigrationState, setHistoryMigrationState] = useState<HistoryMigrationState | null>(null);
  const [isMigratingHistory, setIsMigratingHistory] = useState(false);
  const [isMigratingLearning, setIsMigratingLearning] = useState(false);
  const [cloudOriginalPaths, setCloudOriginalPaths] = useState<Record<string, string>>({});
  // Ensures a single full-page handoff when the session changes (this tab or another).
  const authRedirectStarted = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getLegacyImportState(currentUser.id)
      .then((state) => {
        if (!cancelled) setLegacyImportState(state);
      })
      .catch(() => {
        if (!cancelled) setLegacyImportState(null);
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id]);

  // Load subjects + materials from Supabase. A failed read shows an error screen
  // and is never silently replaced by an empty list or local cache.
  useEffect(() => {
    let cancelled = false;
    // Captured BEFORE the server query: a material deleted while this load was
    // in flight must not be resurrected by its (stale) snapshot. The snapshot
    // was taken before the deletion committed, so marker timestamps recorded
    // after this moment stay in the deletion ledger.
    const loadStartedAt = new Date().toISOString();

    loadCloudLibrary()
      .then(async (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setCloudStatus('error');
          setCloudError(result.error);
          return;
        }

        // Preserve this account's pre-cloud local records (metadata + bodies)
        // in a dedicated area BEFORE the first cloud mirror can overwrite them.
        // Merges, never overwrites, so a later legacy import is also captured.
        if (!hasServerCache(currentUser.id)) {
          const merged = await ensureMigrationOriginals(currentUser.id);
          if (cancelled) return;
          if (!merged.ok) {
            setCloudStatus('error');
            setCloudError(merged.error ?? '로컬 원본을 보존하지 못해 클라우드 동기화를 중단했습니다.');
            return;
          }
        }

        // A stale snapshot may still contain a material deleted mid-load. A
        // marker whose delete committed BEFORE this load started is cleared
        // when the id is visible again (a legitimate server-side re-add).
        reconcileDeletedMaterialMarkers(
          result.data.materials.map((m) => m.id),
          loadStartedAt
        );

        // Mirror the server library into the local cache for offline reads.
        // This is a SERVER CACHE REPLACEMENT, not a local delete: un-migrated
        // materials (body only in localStorage) and local-only (restored)
        // materials that the server list lacks are MERGED back in, never
        // silently dropped. Explicitly deleted ids are never reintroduced.
        saveStoredSubjects(result.data.subjects);
        const mirroredMaterials = saveStoredMaterialsFromServerCache(result.data.materials);
        for (const material of result.data.materials) {
          if (
            material.parsedMarkdown !== undefined ||
            material.rawText !== undefined ||
            material.pages !== undefined
          ) {
            const saved = await saveMaterialContent(material.id, {
              markdown: material.parsedMarkdown ?? '',
              rawText: material.rawText,
              pages: material.pages,
            });
            // The downloaded body is this material's legitimate current body;
            // keep the local identity hash and the sync state in step with it
            // (only after the durable save succeeded, never on a failed write).
            if (saved.persisted) {
              const identity: MaterialHashIdentity = { subjectId: material.subjectId, kind: material.kind };
              recordMaterialBodyHash(material.id, computeMarkdownHash(material.parsedMarkdown ?? ''), identity);
              const serverBodyHash = materialContentHash({
                markdown: material.parsedMarkdown ?? '',
                rawText: material.rawText,
                pages: material.pages,
              });
              recordMaterialSyncState(material.id, {
                serverBodyHash,
                serverHasBody: true,
                localBodyHash: serverBodyHash,
                status: 'confirmed',
              });
            }
          } else {
            // The server row has NO body: never claim body sync for it.
            recordMaterialSyncState(material.id, {
              serverHasBody: false,
              status: materialPolicyOf(material).syncBody ? 'unknown' : 'not_required',
            });
          }
        }
        if (cancelled) return;

        // Load server learning content (concepts / drafts / problems / versions).
        // Server data is authoritative; locally-derived review state is merged
        // in and unpersisted local drafts are kept.
        const supabase = createBrowserSupabaseClient();
        const library = await loadLearningLibrary(supabase);
        if (cancelled) return;
        if (!library.ok) {
          setCloudStatus('error');
          setCloudError(`학습 콘텐츠를 불러오지 못했습니다. ${library.error}`);
          return;
        }
        // Preserve un-migrated local learning content into a dedicated originals
        // area BEFORE the server cache can overwrite the live scope.
        const serverIds = new Set<string>([
          ...library.data.concepts.map((c) => c.id),
          ...library.data.conceptDrafts.map((d) => d.id),
          ...library.data.problems.map((p) => p.id),
          ...library.data.problemDrafts.map((d) => d.id),
        ]);
        const preserved = ensureLearningOriginals(currentUser.id, serverIds);
        if (!preserved.ok) {
          setCloudStatus('error');
          setCloudError(preserved.error ?? '학습 콘텐츠 원본을 보존하지 못했습니다.');
          return;
        }
        const originals = loadLearningOriginals(currentUser.id);
        if (!originals.ok) {
          setCloudStatus('error');
          setCloudError(originals.error);
          return;
        }
        const migratedIds = getMigratedIds(currentUser.id);

        const mergedConcepts = mergeConcepts(library.data.concepts, originals.data.concepts, migratedIds);
        const mergedProblems = mergeProblems(
          library.data.problems,
          originals.data.problems,
          library.data.problemVersions,
          migratedIds
        );
        const mergedConceptDrafts = mergeDrafts(library.data.conceptDrafts, originals.data.conceptDrafts, migratedIds);
        const mergedProblemDrafts = mergeDrafts(library.data.problemDrafts, originals.data.problemDrafts, migratedIds);
        markLearningServerCache(currentUser.id);
        saveStoredConcepts(mergedConcepts);
        saveStoredProblems(mergedProblems);
        saveStoredConceptDrafts(mergedConceptDrafts);
        saveStoredProblemDrafts(mergedProblemDrafts);
        setAllConcepts(mergedConcepts);
        setAllProblems(mergedProblems);
        setConceptDrafts(mergedConceptDrafts);
        setProblemDrafts(mergedProblemDrafts);

        // Load server learning history (attempts / review events / plans / mock exams).
        const [serverAttempts, serverEvents, serverPlans, serverSettings, serverMock] =
          await Promise.all([
            listAttempts(supabase),
            listReviewEvents(supabase),
            listStudyPlanItems(supabase),
            getStudyPlanSettings(supabase),
            listMockExamSessions(supabase),
          ]);
        if (cancelled) return;
        const historyError = [serverAttempts, serverEvents, serverPlans, serverMock].find((r) => !r.ok);
        if (historyError && !historyError.ok) {
          setCloudStatus('error');
          setCloudError(`학습 이력을 불러오지 못했습니다. ${historyError.error}`);
          return;
        }
        const conceptsWithHistory = mergeEventsIntoConcepts(
          mergedConcepts,
          serverEvents.ok ? serverEvents.data : [],
          loadStoredSettings(),
          new Date()
        );
        const mergedAttempts = mergeHistoryById(
          serverAttempts.ok ? serverAttempts.data : [],
          loadStoredAttempts()
        );
        const mergedPlans = mergeHistoryById(
          serverPlans.ok ? serverPlans.data : [],
          loadStoredStudyPlanItems()
        );
        const mergedMockExams = mergeHistoryById(
          serverMock.ok ? serverMock.data : [],
          loadMockExams()
        );
        setAllConcepts(conceptsWithHistory);
        saveStoredConcepts(conceptsWithHistory);
        setAttempts(mergedAttempts);
        saveStoredAttempts(mergedAttempts);
        setStudyPlanItems(mergedPlans);
        saveStoredStudyPlanItems(mergedPlans);
        for (const examSession of mergedMockExams) saveMockExam(examSession);
        setMockExams(mergedMockExams);
        if (serverSettings.ok && serverSettings.data) {
          setStudyPlanSettings(serverSettings.data);
          saveStoredStudyPlanSettings(serverSettings.data);
        }

        // Record that the live scope now holds the server cache, so a later
        // load does not merge server records back into the migration originals.
        markServerCache(currentUser.id);

        setSubjects(result.data.subjects);
        setMaterials(mirroredMaterials);
        setCloudOriginalPaths(result.data.originalPathByMaterialId);
        setActiveSubjectId((prev) =>
          result.data.subjects.some((s) => s.id === prev)
            ? prev
            : result.data.subjects[0]?.id ?? ''
        );
        setCloudMigrationState(getCloudMigrationState(currentUser.id));
        setLearningMigrationState(getLearningMigrationState(currentUser.id));
        setHistoryMigrationState(getHistoryMigrationState(currentUser.id));
        setCloudStatus('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        setCloudStatus('error');
        setCloudError(
          error instanceof Error ? error.message : '서버 학습 데이터를 불러오지 못했습니다.'
        );
      });

    return () => {
      cancelled = true;
    };
  }, [currentUser.id, cloudReloadToken]);

  const reloadCloudLibrary = () => {
    setCloudStatus('loading');
    setCloudError(null);
    setCloudReloadToken((token) => token + 1);
  };



  // Detect sign-out / account changes in other tabs and reset to the correct
  // user context. A full navigation discards in-memory state and in-flight
  // requests, and re-runs the server-side auth guard for the new session.
  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const supabase = createBrowserSupabaseClient();
      const { data } = supabase.auth.onAuthStateChange(
        (event: AuthChangeEvent, session: Session | null) => {
          if (authRedirectStarted.current) return;
          const nextUserId = session?.user?.id ?? null;
          if (event === 'SIGNED_OUT' || !nextUserId) {
            authRedirectStarted.current = true;
            window.location.replace('/login');
            return;
          }
          if (nextUserId !== currentUser.id) {
            authRedirectStarted.current = true;
            window.location.replace('/');
          }
        }
      );
      subscription = data.subscription;
    } catch {
      // Without client configuration the server guard already controls access.
    }
    return () => {
      subscription?.unsubscribe();
    };
  }, [currentUser.id]);

  // With cookie-based sessions, a sign-out or account switch in another tab
  // updates the shared cookies. Re-verify against the Auth server when this tab
  // becomes active; only a definitive "no session" or a different user triggers
  // a handoff (transient network errors are ignored).
  useEffect(() => {
    const verify = async () => {
      if (authRedirectStarted.current) return;
      try {
        const supabase = createBrowserSupabaseClient();
        const { data, error } = await supabase.auth.getUser();
        if (authRedirectStarted.current) return;
        const id = data?.user?.id ?? null;
        if (!error && id) {
          if (id !== currentUser.id) {
            authRedirectStarted.current = true;
            window.location.replace('/');
          }
          return;
        }
        if ((error as { name?: string } | null)?.name === 'AuthSessionMissingError' || (!error && !id)) {
          authRedirectStarted.current = true;
          window.location.replace('/login');
        }
      } catch {
        // Ignore transient failures; data access stays gated on the server.
      }
    };
    const onActive = () => {
      if (document.visibilityState === 'visible') void verify();
    };
    document.addEventListener('visibilitychange', onActive);
    window.addEventListener('focus', onActive);
    return () => {
      document.removeEventListener('visibilitychange', onActive);
      window.removeEventListener('focus', onActive);
    };
  }, [currentUser.id]);

  // Guide the user to register their own AI connection when neither a personal
  // key nor an operator fallback is available.
  useEffect(() => {
    let cancelled = false;
    void fetch('/api/ai-connection')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.success) {
          setAiConnectionMissing(!data.connected && !data.operatorFallback);
        }
      })
      .catch(() => {
        // Status will be surfaced again when an AI feature is used.
      });
    return () => {
      cancelled = true;
    };
  }, [currentUser.id]);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    setLogoutError(null);

    try {
      const supabase = createBrowserSupabaseClient();
      const { error } = await supabase.auth.signOut();
      if (error) {
        // Some sign-out errors still clear the local session. Only stay on the
        // protected screen when a session actually remains.
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          setLogoutError('로그아웃에 실패했습니다. 세션이 남아 있어 다시 시도해야 합니다.');
          setIsLoggingOut(false);
          return;
        }
      }
    } catch (err) {
      setLogoutError(
        err instanceof Error
          ? err.message
          : '로그아웃 중 오류가 발생했습니다. 다시 시도해 주세요.'
      );
      setIsLoggingOut(false);
      return;
    }

    // A full navigation discards all in-memory learning state and aborts any
    // in-flight requests so the next account starts clean. `replace` also keeps
    // the protected screen out of the back/forward history.
    authRedirectStarted.current = true;
    window.location.replace('/login');
  };

  const handleImportLegacy = async () => {
    if (isImportingLegacy) return;
    setIsImportingLegacy(true);
    try {
      const result = await importLegacyData(currentUser.id);
      showToast(result.message);
      setLegacyImportState((prev) =>
        prev
          ? {
              ...prev,
              conflict: result.conflict ? true : prev.conflict,
              resume: result.resume || prev.resume,
            }
          : prev
      );
      if (result.conflict) {
        return;
      }
      if (result.verified) {
        // Preserve the freshly imported metadata + bodies into the migration
        // originals BEFORE reloading (which triggers the cloud mirror). If this
        // fails, do not reload and do not let the cache overwrite the import.
        const preserved = await ensureMigrationOriginals(currentUser.id);
        if (!preserved.ok) {
          showToast(
            `가져온 기록을 보존하지 못해 클라우드 동기화를 중단했습니다. (${preserved.error ?? '보존 실패'})`
          );
          return;
        }
        // Reload so the freshly imported records populate the scoped state.
        window.location.reload();
        return;
      }
    } finally {
      setIsImportingLegacy(false);
    }
  };

  const handleDeclineLegacy = () => {
    declineLegacyImport(currentUser.id);
    setLegacyImportState((prev) => (prev ? { ...prev, declined: true } : prev));
  };

  // Explicit, resumable migration of this account's local subjects/materials.
  const handleMigrateCloud = async () => {
    if (isMigratingCloud) return;
    setIsMigratingCloud(true);
    try {
      const result = await migrateLocalLibraryToCloud(currentUser.id);
      showToast(result.message);
      setCloudMigrationState((prev) =>
        prev
          ? { ...prev, imported: result.ok ? true : prev.imported, resume: !result.ok && prev.resume }
          : prev
      );
      if (result.ok) {
        // Reload the cloud library so migrated records become the source of truth.
        reloadCloudLibrary();
      }
    } finally {
      setIsMigratingCloud(false);
    }
  };

  const handleDeclineCloudMigration = () => {
    declineCloudMigration(currentUser.id);
    setCloudMigrationState((prev) => (prev ? { ...prev, declined: true } : prev));
  };

  // Explicit, resumable migration of local concepts / drafts / problems / versions.
  const handleMigrateLearning = async () => {
    if (isMigratingLearning) return;
    setIsMigratingLearning(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const result = await migrateLocalLearningToCloud(currentUser.id, supabase);
      showToast(result.message);
      if (result.ok) {
        setLearningMigrationState((prev) => (prev ? { ...prev, imported: true } : prev));
      }
    } finally {
      setIsMigratingLearning(false);
    }
  };

  const handleDeclineLearning = () => {
    declineLearningMigration(currentUser.id);
    setLearningMigrationState((prev) => (prev ? { ...prev, declined: true } : prev));
  };

  // One-time migration of local learning history (attempts / reviews / plans / mock exams).
  const handleMigrateHistory = async () => {
    if (isMigratingHistory) return;
    setIsMigratingHistory(true);
    try {
      const supabase = createBrowserSupabaseClient();
      const result = await migrateLocalHistoryToCloud(currentUser.id, supabase);
      showToast(result.message);
      if (result.ok) {
        setHistoryMigrationState((prev) => (prev ? { ...prev, imported: true } : prev));
        reloadCloudLibrary();
      }
    } finally {
      setIsMigratingHistory(false);
    }
  };

  const handleDeclineHistory = () => {
    declineHistoryMigration(currentUser.id);
    setHistoryMigrationState((prev) => (prev ? { ...prev, declined: true } : prev));
  };

  // Original files are private: open them through a short-lived signed URL.
  const handleOpenOriginal = async (materialId: string) => {
    const path = cloudOriginalPaths[materialId];
    if (!path) {
      showToast('이 자료에는 저장된 원본 파일이 없습니다.');
      return;
    }
    const result = await createMaterialSignedUrl(path);
    if (!result.ok) {
      showToast(`원본 보기 실패: ${result.error}`);
      return;
    }
    window.open(result.data, '_blank', 'noopener,noreferrer');
  };

  // Local-only relink: connect a file on this device to metadata-only material.
  // Never uploads to the server; material id, concept/problem links and history
  // are preserved because the material record itself is not replaced.
  // The storage scope is pinned at the start: the file is written to (and
  // verified against) the account the reconnect started in, and an account
  // change stops the flow before touching UI or metadata of another account.
  const handleReconnectOriginal = async (material: Material, file: File): Promise<boolean> => {
    const pinnedScopeId = getStorageScopeId();
    let hash = '';
    try {
      hash = await hashBlob(file);
    } catch {
      showToast('파일을 읽지 못했습니다. 다시 시도해 주세요.');
      return false;
    }
    if (material.originalHash && hash !== material.originalHash) {
      showToast('선택한 파일의 해시가 이 자료의 원본과 일치하지 않습니다. 기존 자료는 그대로 유지됩니다.');
      return false;
    }
    if (!material.originalHash) {
      const ok = window.confirm(
        '이 자료에는 원본 식별 정보(해시)가 없어 자동 확인할 수 없습니다. 선택한 파일을 이 자료의 원본으로 연결할까요?'
      );
      if (!ok) return false;
    }
    if (getStorageScopeId() !== pinnedScopeId) {
      return false;
    }
    const saved = await saveMaterialOriginalInScope(pinnedScopeId, material.id, file, file.type || 'application/pdf');
    if (!saved.persisted) {
      showToast(`원본 저장 실패: ${saved.error}. 다시 시도해 주세요.`);
      return false;
    }
    const verify = await loadMaterialOriginalInScope(pinnedScopeId, material.id);
    if (verify.status !== 'found' || verify.hash !== saved.hash) {
      showToast('원본 저장을 검증하지 못했습니다. 다시 시도해 주세요.');
      return false;
    }
    // A late result must never be applied to another account's UI or records.
    if (getStorageScopeId() !== pinnedScopeId) {
      return true;
    }
    const updated = materials.map((m) =>
      m.id === material.id ? { ...m, originalHash: m.originalHash ?? saved.hash, fileSize: saved.size } : m
    );
    setMaterials(updated);
    saveStoredMaterials(updated);
    // If the body is still missing, guide the next supported action.
    const body = await loadMaterialContentInScope(pinnedScopeId, material.id);
    const hasBody = body.status === 'found' && Boolean(body.content.markdown);
    if (!hasBody) {
      showToast('원본이 이 기기에 연결되었습니다. 변환 본문(MD)도 없으니 "본문 다시 연결"을 누르거나 자료를 다시 변환해 주세요.');
    } else {
      showToast('원본이 이 기기에 다시 연결되었습니다.');
    }
    return true;
  };

  // Local-only relink of a converted Markdown body. Verifies the file against
  // the stored body identity (bodyHash; local registry survives cloud metadata
  // refreshes) when present; asks for explicit confirmation when the material
  // carries no identity. Never uploads to the server: the body goes to
  // IndexedDB and localStorage keeps metadata only. The storage scope is
  // pinned at the start for the same reason as the original relink above.
  const handleReconnectBody = async (material: Material, file: File): Promise<boolean> => {
    const pinnedScopeId = getStorageScopeId();
    let text = '';
    try {
      text = await file.text();
    } catch {
      showToast('파일을 읽지 못했습니다. 다시 시도해 주세요.');
      return false;
    }
    if (!text.trim()) {
      showToast('빈 파일입니다. 변환된 Markdown 파일을 선택해 주세요.');
      return false;
    }
    const candidateHash = computeMarkdownHash(text);
    // The identity-aware resolver never returns a hash recorded for a different
    // subjectId/kind, and never falls back to a stale metadata hash in that case.
    const expectedHash = resolveStoredMaterialBodyHash(material);
    if (expectedHash) {
      if (expectedHash !== candidateHash) {
        showToast('선택한 파일의 내용이 이 자료의 본문 식별 정보와 일치하지 않습니다. 기존 자료는 그대로 유지됩니다.');
        return false;
      }
    } else if (
      !window.confirm(
        '이 자료에는 본문 식별 정보가 없어 자동 확인할 수 없습니다. 선택한 파일을 이 자료의 본문으로 연결할까요?'
      )
    ) {
      return false;
    }
    if (getStorageScopeId() !== pinnedScopeId) {
      return false;
    }
    const saved = await saveMaterialContentInScope(pinnedScopeId, material.id, { markdown: text });
    if (!saved.persisted) {
      showToast(`본문 저장 실패: ${saved.error}. 다시 시도해 주세요.`);
      return false;
    }
    const verify = await loadMaterialContentInScope(pinnedScopeId, material.id, { skipMemoryCache: true });
    if (verify.status !== 'found' || verify.content.markdown !== text) {
      showToast('본문 저장을 검증하지 못했습니다. 다시 시도해 주세요.');
      return false;
    }
    // The saved body belongs to the ORIGINAL account's storage; applying the
    // metadata/UI is only safe while still on that account.
    if (getStorageScopeId() !== pinnedScopeId) {
      return true;
    }
    const hashRecorded = recordMaterialBodyHash(material.id, candidateHash, {
      subjectId: material.subjectId,
      kind: material.kind,
    });
    // A reconnect is device-only: the server body (if any) now differs from the
    // local body. Record it as pending so the list never claims "synced".
    recordMaterialSyncState(material.id, {
      localBodyHash: materialContentHash({ markdown: text }),
      status: materialPolicyOf(material).syncBody ? 'pending' : 'not_required',
    });
    const updated = materials.map((m) =>
      m.id === material.id ? { ...m, parsedMarkdown: text, bodyHash: candidateHash } : m
    );
    setMaterials(updated);
    saveStoredMaterials(updated);
    if (hashRecorded) {
      showToast('변환 본문(Markdown)이 이 기기에 다시 연결되었습니다.');
    } else {
      showToast('본문은 연결되었지만 본문 식별 정보 저장에 실패했습니다. 다시 연결할 때 다시 확인해 주세요.');
    }
    return true;
  };

  // Hydration-safe flag: false during SSR/first hydration commit, true after.
  const isHydrated = useSyncExternalStore(hydrationSubscribe, () => true, () => false);

  // Initial load runs during a guarded render phase rather than inside an effect.
  // This avoids cascading renders while remaining hydration-safe (the first client
  // commit still matches the server render).
  if (isHydrated && !isLoaded) {
    setIsLoaded(true);

    const integrity = checkStoredDataIntegrity();
    if (!integrity.ok) {
      // Do not fall back to an empty account or demo data; surface an error.
      setLoadError(integrity.failedKeys);
    } else {
    const loadedSubjects = loadStoredSubjects();
    const loadedSubjectId = loadActiveSubjectId();
    const loadedMaterials = loadStoredMaterials();
    const loadedConcepts = loadStoredConcepts();
    const loadedDrafts = loadStoredConceptDrafts();
    const loadedProblems = loadStoredProblems();
    const loadedProblemDrafts = loadStoredProblemDrafts();
    const loadedAttempts = loadStoredAttempts();
    const loadedSettings = loadStoredSettings();
    const loadedPlanSettings = loadStoredStudyPlanSettings();
    const loadedPlanItems = loadStoredStudyPlanItems();
    const loadedMockExams = loadMockExams();
    const loadedPersonalization = loadStoredPersonalizationSettings();

    setSubjects(loadedSubjects);
    setActiveSubjectId(loadedSubjectId);
    setMaterials(loadedMaterials);
    setAllConcepts(loadedConcepts);
    setConceptDrafts(loadedDrafts);
    setAllProblems(loadedProblems);
    setProblemDrafts(loadedProblemDrafts);
    setAttempts(loadedAttempts);
    setSettings(loadedSettings);
    setStudyPlanSettings(loadedPlanSettings);
    setStudyPlanItems(loadedPlanItems);
    setMockExams(loadedMockExams);
    setPersonalizationSettings(loadedPersonalization);
    setRechallengeReservations(loadRechallengeReservations());

    // Initial concept selection prioritizing top urgent review recommendation
    const subjectConcepts = loadedConcepts.filter((c) => c.subjectId === loadedSubjectId);
    const activeSub = loadedSubjects.find((s) => s.id === loadedSubjectId);
    const initialRanking = rankConceptsForReview(subjectConcepts, loadedSettings, activeSub?.examAt, new Date());

    if (initialRanking.rankedRecommendations.length > 0) {
      const topId = initialRanking.rankedRecommendations[0].conceptId;
      setSelectedConceptId(topId);
      const topConcept = subjectConcepts.find((c) => c.id === topId);
      const lastEvent = topConcept?.events[topConcept.events.length - 1];
      if (lastEvent) {
        setSelectedEventId(lastEvent.id);
      }
    } else if (subjectConcepts.length > 0) {
      const firstConcept = subjectConcepts[0];
      setSelectedConceptId(firstConcept.id);
      const lastEvent = firstConcept.events[firstConcept.events.length - 1];
      if (lastEvent) {
        setSelectedEventId(lastEvent.id);
      }
    }
    }

    // localStorage keeps material metadata only; bodies live in IndexedDB.
    // 1) Move bodies still embedded in the stored metadata into IndexedDB
    //    (verified; the original localStorage value is preserved on failure).
    // 2) Hydrate the in-memory metadata with bodies from IndexedDB so screens
    //    keep working without ever writing bodies back into localStorage.
    // 3) Demo materials whose body is nowhere locally are re-seeded from the
    //    initial dataset (verified write; memory fallback otherwise).
    void (async () => {
      try {
        const migration = await migrateStoredMaterialBodies();
        if (!migration.ok && migration.attempted > 0) {
          showToast(
            '일부 자료 본문의 로컬 이관이 완료되지 않았습니다. 기존 본문은 보존되었으며 다음 실행에 다시 시도됩니다.'
          );
        }
        const bodyByMaterialId = new Map<string, { markdown: string; rawText?: string; pages?: MaterialPage[] }>();
        const stored = loadStoredMaterials();
        const demoById = new Map(INITIAL_MATERIALS.map((m) => [m.id, m]));
        for (const material of stored) {
          if (material.parsedMarkdown !== undefined) continue;
          const result = await loadMaterialContentResult(material.id);
          if (result.status === 'found') {
            bodyByMaterialId.set(material.id, {
              markdown: result.content.markdown,
              rawText: result.content.rawText,
              pages: result.content.pages,
            });
            continue;
          }
          if (material.isDemo) {
            const demo = demoById.get(material.id);
            if (demo && typeof demo.parsedMarkdown === 'string') {
              const content = { markdown: demo.parsedMarkdown, rawText: demo.rawText, pages: demo.pages };
              bodyByMaterialId.set(material.id, content);
              await saveMaterialContent(material.id, content);
            }
          }
        }
        if (bodyByMaterialId.size > 0) {
          setMaterials((prev) =>
            prev.map((m) => {
              const body = bodyByMaterialId.get(m.id);
              if (!body || m.parsedMarkdown !== undefined) return m;
              return { ...m, parsedMarkdown: body.markdown, rawText: m.rawText ?? body.rawText, pages: m.pages ?? body.pages };
            })
          );
        }
      } catch {
        // Hydration is best-effort; the metadata-only view stays usable.
      }
    })();
  }

  // Report initialization to the splash once the first data load settles.
  useEffect(() => {
    if (!isLoaded) return;
    if (loadError) {
      reportAppError(
        '저장된 학습 데이터를 불러오지 못했습니다. 기록이 손상되었을 수 있습니다. 데이터는 삭제되지 않았으니 다시 시도해 주세요.'
      );
      return;
    }
    if (cloudStatus === 'loading') return;
    if (cloudStatus === 'error') {
      reportAppError(cloudError ?? '서버 학습 데이터를 불러오지 못했습니다.');
      return;
    }
    reportAppReady();
  }, [isLoaded, loadError, cloudStatus, cloudError]);

  // Re-check plan storage and KST date sync on window focus
  useEffect(() => {
    const handleFocus = () => {
      setStudyPlanItems(loadStoredStudyPlanItems());
      setStudyPlanSettings(loadStoredStudyPlanSettings());
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // Filtered Subject Data
  const activeSubject = useMemo(() => {
    return subjects.find((s) => s.id === activeSubjectId) || subjects[0];
  }, [subjects, activeSubjectId]);

  const subjectConcepts = useMemo(() => {
    if (!activeSubject) return [];
    return allConcepts.filter((c) => c.subjectId === activeSubject.id);
  }, [allConcepts, activeSubject]);

  const subjectProblems = useMemo(() => {
    if (!activeSubject) return [];
    return allProblems.filter((p) => p.subjectId === activeSubject.id);
  }, [allProblems, activeSubject]);

  const activeSubjectDrafts = useMemo(() => {
    if (!activeSubject) return [];
    return conceptDrafts.filter((d) => d.subjectId === activeSubject.id);
  }, [conceptDrafts, activeSubject]);

  const activeSubjectProblemDrafts = useMemo(() => {
    if (!activeSubject) return [];
    return problemDrafts.filter((d) => d.subjectId === activeSubject.id);
  }, [problemDrafts, activeSubject]);

  const activeSubjectReportedCount = useMemo(() => {
    return subjectProblems.filter(
      (p) =>
        p.qualityStatus === 'reported' ||
        p.qualityStatus === 'under_review' ||
        p.qualityStatus === 'review_after_edit'
    ).length;
  }, [subjectProblems]);

  const availableSubjectProblems = useMemo(() => {
    return subjectProblems.filter(isProblemAvailableForPractice);
  }, [subjectProblems]);

  const activeSessionProblem = useMemo(() => {
    if (activeProblemIdForSession) {
      return availableSubjectProblems.find((p) => p.id === activeProblemIdForSession);
    }
    const conceptId = subjectConcepts.find((c) => c.id === selectedConceptId)?.id || subjectConcepts[0]?.id;
    const linked = availableSubjectProblems.filter((p) => p.conceptIds.includes(conceptId || ''));
    return (
      linked.find((p) => p.type === selectedProblemType) || linked[0]
    );
  }, [subjectConcepts, selectedConceptId, availableSubjectProblems, activeProblemIdForSession, selectedProblemType]);

  // The session's OWN problem, pinned across subject switches. A session opened
  // for a problem must never be re-labelled as a different subject's problem.
  const pinnedSessionProblem = useMemo(() => {
    if (!activeProblemIdForSession) return null;
    return allProblems.find((p) => p.id === activeProblemIdForSession) ?? null;
  }, [allProblems, activeProblemIdForSession]);
  const pinnedSessionSubject = useMemo(() => {
    if (!pinnedSessionProblem) return null;
    return subjects.find((s) => s.id === pinnedSessionProblem.subjectId) ?? null;
  }, [subjects, pinnedSessionProblem]);
  // Pure affiliation: a session opened for another subject never becomes the
  // active subject's session; the UI shows its real owner and a return path.
  const sessionAffiliation = useMemo(
    () => resolveSessionAffiliation(pinnedSessionProblem, activeSubject.id),
    [pinnedSessionProblem, activeSubject.id]
  );
  const sessionSubjectMismatch =
    isProblemSessionOpen && sessionAffiliation.kind === 'other_subject';

  // Stage 10: Deterministic personal correction state recomputed from real records.
  // Same inputs (records, problems, settings, reference date) always yield the same state.
  const correctionStateComputed = useMemo(() => {
    return computeCorrectionState({
      attempts,
      mockExams,
      problems: allProblems,
      subjects,
      concepts: allConcepts,
      settings: personalizationSettings,
      referenceDate: new Date(),
    });
  }, [attempts, mockExams, allProblems, subjects, allConcepts, personalizationSettings]);

  // Persist the recalculated state so it is recoverable after refresh and
  // is invalidated whenever records or quality status change.
  useEffect(() => {
    if (!isLoaded) return;
    saveStoredPersonalizationState(correctionStateComputed);
  }, [isLoaded, correctionStateComputed]);

  const effectiveCorrectionState = correctionStateComputed;
  const intervalMultiplier = getEffectiveIntervalMultiplier(personalizationSettings, effectiveCorrectionState);
  const personalizationNote =
    effectiveCorrectionState.appliedMultiplier !== 1
      ? `개인별 보정 x${effectiveCorrectionState.appliedMultiplier.toFixed(2)}`
      : undefined;

  // Stage 9: Deterministic Study Plan Summary Memo (uses the SAME personalization multiplier
  // as today's review so both paths can never diverge).
  const studyPlanSummary = useMemo(() => {
    return generateStudyPlan({
      subjects,
      concepts: allConcepts,
      problems: allProblems,
      attempts,
      settings: studyPlanSettings,
      retentionSettings: settings,
      referenceDate: new Date(),
      existingItems: studyPlanItems,
      personalizationMultiplier: intervalMultiplier,
      personalizationNote,
      rechallengeReservations,
    });
  }, [subjects, allConcepts, allProblems, attempts, studyPlanSettings, settings, studyPlanItems, intervalMultiplier, personalizationNote, rechallengeReservations]);

  // Persist newly-generated plan items to the server (insert-only, so a stale
  // regeneration can never overwrite a server-side completion).
  const planItemSignature = useMemo(() => {
    const items = [
      ...studyPlanSummary.days.flatMap((d) => d.items),
      ...studyPlanSummary.days.flatMap((d) => d.unassignedItems),
    ];
    return items.map((i) => i.id).sort().join('|');
  }, [studyPlanSummary]);
  const lastPlanSyncRef = useRef('');
  useEffect(() => {
    if (!isLoaded || !isSupabaseConfigured()) return;
    if (planItemSignature === lastPlanSyncRef.current) return;
    lastPlanSyncRef.current = planItemSignature;
    const byId = new Map<string, StudyPlanItem>();
    for (const day of studyPlanSummary.days) {
      for (const item of [...day.items, ...day.unassignedItems]) byId.set(item.id, item);
    }
    const items = Array.from(byId.values());
    if (items.length === 0) return;
    void (async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        const result = await createStudyPlanItems(supabase, items);
        if (!result.ok) showToast(`학습 계획 서버 저장 실패: ${result.error}`);
      } catch {
        // transient; retried when the plan signature changes
      }
    })();
  }, [isLoaded, planItemSignature, studyPlanSummary]);

  const selectedConcept = useMemo(() => {
    return (
      subjectConcepts.find((c) => c.id === selectedConceptId) ||
      subjectConcepts[0]
    );
  }, [subjectConcepts, selectedConceptId]);

  // Compact today-study summary for the main page (top pending items only).
  const todayDigest = useMemo(
    () => getTodayPendingItems(studyPlanSummary, 4),
    [studyPlanSummary]
  );
  const todayDayLabel = useMemo(() => {
    const day = studyPlanSummary.days.find((d) => d.date === studyPlanSummary.todayDate);
    return day?.dayLabel;
  }, [studyPlanSummary]);
  const activeMockSession = useMemo(() => {
    if (!activeSubject) return null;
    return (
      mockExams.find((s) => s.subjectId === activeSubject.id && s.status !== 'recorded' && s.status !== 'abandoned') ??
      null
    );
  }, [mockExams, activeSubject]);
  const primaryCta = useMemo(
    () => resolvePrimaryCta(activeMockSession, todayDigest.items[0] ?? null),
    [activeMockSession, todayDigest]
  );

  /**
   * Applies the local + server side effects of a material body edit.
   *
   * Shared by a normal server save and by the response-loss recovery
   * (`already_saved`) path so the material metadata, the linked problems'
   * stale/review flags, the concepts/drafts review state and the server
   * reflection ALWAYS run — never skipped just because the body was already
   * stored on the server.
   *
   * Idempotent: re-running only re-applies the same flags. Past attempt and
   * mock-exam snapshots are never touched. A late response from another account
   * is dropped (scope guard).
   */
  const applyMaterialEditSideEffects = async (
    updatedMat: Material,
    scopeAtStart: string
  ): Promise<{
    outdatedIds: string[];
    reviewIds: string[];
    affectedConceptsCount: number;
    serverReflectionFailed: number;
  }> => {
    const { updatedProblems: newProblems, outdatedIds, reviewIds } = applyMaterialEditToProblems(
      allProblems,
      updatedMat,
      allConcepts
    );
    const newHash = computeMarkdownHash(updatedMat.parsedMarkdown || '');
    let affectedConceptsCount = 0;
    const newConcepts = allConcepts.map((c) => {
      if (c.subjectId === updatedMat.subjectId && c.materialIds.includes(updatedMat.id)) {
        affectedConceptsCount++;
        return {
          ...c,
          needsSourceReview: true,
          sourceEvidence: c.sourceEvidence
            ? {
                ...c.sourceEvidence,
                verified: false,
                verificationNote: '근거 자료 본문이 수정되어 재검토가 필요합니다.',
              }
            : undefined,
        };
      }
      return c;
    });
    let affectedDraftsCount = 0;
    const newDrafts = conceptDrafts.map((d) => {
      if (d.materialId === updatedMat.id && d.sourceMarkdownHash !== newHash) {
        affectedDraftsCount++;
        return { ...d, needsSourceReview: true };
      }
      return d;
    });

    // A late response must never write to another account's storage or UI.
    if (getStorageScopeId() !== scopeAtStart) {
      return { outdatedIds: [], reviewIds: [], affectedConceptsCount: 0, serverReflectionFailed: 0 };
    }

    const updated = materials.map((m) => (m.id === updatedMat.id ? updatedMat : m));
    setMaterials(updated);
    saveStoredMaterials(updated);
    setEditingMaterial(updatedMat);
    setAllProblems(newProblems);
    saveStoredProblems(newProblems);
    if (affectedConceptsCount > 0) {
      setAllConcepts(newConcepts);
      saveStoredConcepts(newConcepts);
    }
    if (affectedDraftsCount > 0) {
      setConceptDrafts(newDrafts);
      saveStoredConceptDrafts(newDrafts);
    }

    // Persist the affected review flags to Supabase (best-effort). A failure is
    // reported as a partial result, never hidden.
    let serverReflectionFailed = 0;
    if (currentUser && isSupabaseConfigured()) {
      const supabase = createBrowserSupabaseClient();
      const outdatedOrReview = [...outdatedIds, ...reviewIds]
        .map((pid) => newProblems.find((p) => p.id === pid))
        .filter((p): p is Problem => Boolean(p));
      const affectedConceptRows = newConcepts.filter(
        (c) => c.subjectId === updatedMat.subjectId && c.materialIds.includes(updatedMat.id)
      );
      const affectedDraftRows = newDrafts.filter(
        (d) => d.materialId === updatedMat.id && d.needsSourceReview
      );
      const results = await Promise.all([
        ...outdatedOrReview.map(async (prob) => {
          const r = await updateProblemQuality(supabase, prob.id, {
            isOutdated: prob.isOutdated,
            needsSourceReview: prob.needsSourceReview,
            payload: prob as unknown as Record<string, unknown>,
          });
          return r.ok;
        }),
        ...affectedConceptRows.map(async (c) => {
          const r = await supabase.from('concepts').update({ payload: c as unknown as Record<string, unknown> }).eq('id', c.id);
          return !r.error;
        }),
        ...affectedDraftRows.map(async (d) => {
          const r = await supabase.from('concept_drafts').update({ payload: d as unknown as Record<string, unknown> }).eq('id', d.id);
          return !r.error;
        }),
      ]);
      serverReflectionFailed = results.filter((ok) => !ok).length;
    }

    return { outdatedIds, reviewIds, affectedConceptsCount, serverReflectionFailed };
  };

  // Composes the single user-facing toast for a material edit outcome.
  const showMaterialEditToast = (
    title: string,
    effects: { outdatedIds: string[]; reviewIds: string[]; affectedConceptsCount: number; serverReflectionFailed: number },
    mode: 'saved' | 'recovered' | 'local' | 'fallback'
  ) => {
    const parts: string[] = [];
    if (effects.affectedConceptsCount > 0) parts.push(`개념 ${effects.affectedConceptsCount}건`);
    if (effects.outdatedIds.length > 0) parts.push(`구버전 문제 ${effects.outdatedIds.length}건`);
    if (effects.reviewIds.length > 0) parts.push(`확인 필요 문제 ${effects.reviewIds.length}건`);

    let message: string;
    if (parts.length > 0) {
      const prefix = mode === 'recovered' ? '[응답 유실 복구] ' : mode === 'local' ? '로컬 전용 수정: ' : '';
      message = `${prefix}[${title}] 수정으로 연관 ${parts.join(', ')}을 검토 필요 상태로 표시했습니다.`;
    } else if (mode === 'local') {
      message = `[${title}] 로컬 전용 자료 내용이 저장되었습니다.`;
    } else if (mode === 'fallback') {
      message = `[${title}] 수정 내용이 저장되었으나 서버 마이그레이션 9 미적용으로 일부 정책/해시는 서버에 저장되지 않았습니다.`;
    } else if (mode === 'recovered') {
      message = `[${title}] 이전 서버 저장을 확인해 복구했습니다. (재업로드·버전 증가 없음)`;
    } else {
      message = `[${title}] 수정 내용이 서버에 저장되었습니다.`;
    }
    if (effects.serverReflectionFailed > 0) {
      message += ` 일부 검토 상태를 서버에 반영하지 못했습니다(${effects.serverReflectionFailed}건) — 다시 저장하면 반영됩니다.`;
    }
    showToast(message);
  };

  // Restores material metadata from a backup. The persistence is verified by
  // reading it back; a failed metadata save is reported so the caller never
  // shows a failed restore as success. The backup's local body identity hash
  // is recorded only after the metadata persistence is verified.
  const handleRestoreMaterials = async (restored: Material[]): Promise<boolean> => {
    const byId = new Map(materials.map((m) => [m.id, m]));
    for (const material of restored) {
      if (!byId.has(material.id)) byId.set(material.id, material);
      // An explicit restore is a user-approved resurrection: clear any deletion
      // marker so the restore is not silently filtered out.
      clearDeletedMaterialMarker(material.id);
    }
    const updated = Array.from(byId.values());
    setMaterials(updated);
    const persisted = saveStoredMaterialsVerified(updated);
    if (persisted) {
      for (const material of restored) {
        // Restored materials live only on this device until they are synced;
        // mark them so a later server cache refresh keeps their metadata.
        markMaterialLocalOnly(material.id);
        if (material.bodyHash) {
          recordMaterialBodyHash(material.id, material.bodyHash, {
            subjectId: material.subjectId,
            kind: material.kind,
          });
        }
      }
      showToast(`백업에서 자료 ${restored.length}건의 메타데이터를 복원했습니다.`);
    } else {
      showToast('복원한 자료 메타데이터 저장에 실패했습니다. 다시 시도해 주세요.');
    }
    return persisted;
  };

  const migrationBlocks: MigrationUiBlock[] = (() => {
    const blocks: MigrationUiBlock[] = [];
    if (legacyImportState && legacyImportState.hasLegacyData && !legacyImportState.imported && !legacyImportState.declined) {
      blocks.push({
        key: 'legacy',
        title: '기존 학습 기록 가져오기',
        description: legacyImportState.conflict
          ? '이미 이 계정에 학습 기록이 있어 자동으로 가져오지 않습니다. 현재 계정 기록을 그대로 유지합니다.'
          : legacyImportState.resume
            ? '중단된 가져오기를 이어서 완료합니다. 이미 복사된 기록은 검증 후 건너뜁니다.'
            : '이전에 이 브라우저에서 쓰던 공용 학습 기록을 이 계정으로 가져옵니다. 기존 기록은 보존됩니다.',
        pending: true,
        busy: isImportingLegacy,
        actionLabel: legacyImportState.resume ? '가져오기 계속하기' : '기존 학습 기록 가져오기',
        onMigrate: legacyImportState.conflict ? undefined : handleImportLegacy,
        onDecline: handleDeclineLegacy,
        declineLabel: legacyImportState.conflict ? '확인' : '나중에',
      });
    }
    if (cloudMigrationState && cloudMigrationState.hasLocalData && !cloudMigrationState.imported && !cloudMigrationState.declined) {
      blocks.push({
        key: 'cloud',
        title: '과목·자료 이전',
        description:
          '과목과 학습 자료의 목록을 클라우드로 이전합니다. 로컬 원본은 그대로 보존되며, 같은 ID의 다른 내용은 자동으로 덮어쓰지 않습니다.',
        pending: true,
        busy: isMigratingCloud,
        actionLabel: '클라우드로 이전',
        onMigrate: handleMigrateCloud,
        onDecline: handleDeclineCloudMigration,
      });
    }
    if (learningMigrationState && learningMigrationState.hasLocalData && !learningMigrationState.imported && !learningMigrationState.declined) {
      blocks.push({
        key: 'learning',
        title: '학습 콘텐츠 이전',
        description:
          '개념·문제·버전 기록을 이전합니다. 풀이·복습 이력은 학습 이력 단계에서 별도로 이전합니다. 과목·자료 이전을 먼저 완료해야 합니다.',
        pending: true,
        busy: isMigratingLearning,
        actionLabel: '학습 콘텐츠 이전',
        onMigrate: handleMigrateLearning,
        onDecline: handleDeclineLearning,
      });
    }
    if (historyMigrationState && historyMigrationState.hasLocalData && !historyMigrationState.imported && !historyMigrationState.declined) {
      blocks.push({
        key: 'history',
        title: '학습 이력 이전',
        description:
          '풀이·복습·계획·모의시험 기록을 이전합니다. 로컬 원본은 서버 반영이 검증될 때까지 그대로 보존됩니다.',
        pending: true,
        busy: isMigratingHistory,
        actionLabel: '학습 이력 이전',
        onMigrate: handleMigrateHistory,
        onDecline: handleDeclineHistory,
      });
    }
    return blocks;
  })();

  const sessionConcept = activeSessionProblem && (
    subjectConcepts.find((c) => c.id === selectedConcept?.id && activeSessionProblem.conceptIds.includes(c.id)) ||
    subjectConcepts.find((c) => activeSessionProblem.conceptIds.includes(c.id))
  );

  const selectedEvent = useMemo(() => {
    if (!selectedConcept || !selectedConcept.events) return null;
    if (selectedEventId) {
      const found = selectedConcept.events.find((e) => e.id === selectedEventId);
      if (found) return found;
    }
    // Default to last event
    return selectedConcept.events[selectedConcept.events.length - 1] || null;
  }, [selectedConcept, selectedEventId]);

  // Compared Concepts
  const comparedConcepts = useMemo(() => {
    return subjectConcepts.filter((c) => comparedConceptIds.includes(c.id));
  }, [subjectConcepts, comparedConceptIds]);

  // Exam D-Day calculation for timeline projection limit
  const examDDay = useMemo(() => {
    if (!activeSubject) return 14;
    const calc = calculateDDay(activeSubject.examAt);
    return calc.calendarDiff > 0 ? calc.calendarDiff : 14;
  }, [activeSubject]);

  // Stage 5: Deterministic Spaced Repetition Review Recommendations & Urgency Ranking
  const reviewRanking = useMemo(() => {
    if (!activeSubject) {
      return { rankedRecommendations: [], dueTodayCount: 0, unstudiedConcepts: [] };
    }
    return rankConceptsForReview(
      subjectConcepts,
      settings,
      activeSubject.examAt,
      new Date(),
      intervalMultiplier
    );
  }, [subjectConcepts, settings, activeSubject, intervalMultiplier]);

  const selectedConceptRecommendation = useMemo(() => {
    if (!selectedConcept) return null;
    return (
      reviewRanking.rankedRecommendations.find((r) => r.conceptId === selectedConcept.id) || null
    );
  }, [reviewRanking, selectedConcept]);

  // Subject Switch Handler (Clean Isolation between subjects)
  const handleSelectSubject = (newSubjectId: string) => {
    setActiveSubjectId(newSubjectId);
    saveActiveSubjectId(newSubjectId);

    // Select top recommended concept or first concept in new subject
    const newConcepts = allConcepts.filter((c) => c.subjectId === newSubjectId);
    const newSubject = subjects.find((s) => s.id === newSubjectId);
    const ranking = rankConceptsForReview(newConcepts, settings, newSubject?.examAt, new Date());

    if (ranking.rankedRecommendations.length > 0) {
      const topConceptId = ranking.rankedRecommendations[0].conceptId;
      setSelectedConceptId(topConceptId);
      const topConcept = newConcepts.find((c) => c.id === topConceptId);
      const lastEvent = topConcept?.events[topConcept.events.length - 1];
      setSelectedEventId(lastEvent ? lastEvent.id : null);
    } else if (newConcepts.length > 0) {
      setSelectedConceptId(newConcepts[0].id);
      const lastEvent = newConcepts[0].events[newConcepts[0].events.length - 1];
      setSelectedEventId(lastEvent ? lastEvent.id : null);
    } else {
      setSelectedConceptId('');
      setSelectedEventId(null);
    }

    // Adjust default problem type based on subject domain
    const targetSubject = subjects.find((s) => s.id === newSubjectId);
    if (targetSubject?.domain === 'computer_science') {
      setSelectedProblemType('impl_descriptive');
    } else {
      setSelectedProblemType('essay_descriptive');
    }

    // Reset comparison
    setIsComparisonMode(false);
    setComparedConceptIds([]);

    if (typeof window !== 'undefined') {
      const url = buildDashboardUrl({
        tab: activeTab,
        subjectId: newSubjectId,
        materialId: editingMaterial?.id,
        problemId: activeSessionProblem?.id,
        attemptId: selectedAttemptId || undefined,
      });
      window.history.pushState(null, '', url || window.location.pathname);
    }

    showToast(`과목이 [${targetSubject?.name || '새 과목'}]으로 전환되었습니다.`);
  };

  const handleSelectTab = (
    newTab: DashboardTab,
    extraParams?: { problemId?: string; materialId?: string; attemptId?: string; examId?: string }
  ) => {
    setActiveTab(newTab);
    if (typeof window !== 'undefined') {
      const url = buildDashboardUrl({
        tab: newTab,
        subjectId: activeSubjectId || undefined,
        problemId: extraParams?.problemId ?? (newTab === 'session' ? (activeSessionProblem?.id || activeProblemIdForSession || undefined) : undefined),
        materialId: extraParams?.materialId ?? (newTab === 'materials' ? editingMaterial?.id : undefined),
        attemptId: extraParams?.attemptId ?? (newTab === 'history' ? (selectedAttemptId || undefined) : undefined),
        examId: extraParams?.examId,
      });
      window.history.pushState(null, '', url || window.location.pathname);
    }
  };

  const openProblemSessionScreen = (probId?: string, rechallengeId?: string, planId?: string) => {
    if (probId) {
      setActiveProblemIdForSession(probId);
    }
    if (rechallengeId !== undefined) {
      setActiveRechallengeReservationId(rechallengeId);
    }
    if (planId !== undefined) {
      setActivePlanItemIdForSession(planId);
    }
    setIsProblemSessionOpen(true);
    handleSelectTab('session', { problemId: probId });
  };

  // Closing the practice screen clears every session-scoped state at once so a
  // later subject switch cannot resurrect a half-open session.
  const closeProblemSession = () => {
    setIsProblemSessionOpen(false);
    setActiveProblemIdForSession(null);
    setActiveRechallengeReservationId(null);
    setActivePlanItemIdForSession(null);
    handleSelectTab('problems');
  };

  const openMockExamScreen = (config?: MockExamInitialConfig | null) => {
    setMockExamInitialConfig(config ?? null);
    // Opened from the menu, not from an exam URL: resume the active session.
    setExamIdFromUrl(null);
    setIsMockExamModalOpen(true);
    handleSelectTab('exam');
  };

  // Synchronize activeTab, activeSubject and deep items from URL query params
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const syncFromUrl = () => {
      const parsed = parseDashboardUrl(window.location.search);
      const resolution = resolveDashboardUrl(parsed, {
        isLoaded,
        isCloudLoading: isSupabaseConfigured() && cloudStatus === 'loading',
        subjects,
        materials,
        problems: allProblems,
        attempts,
        mockExams,
      });

      if (resolution.status === 'loading') {
        return;
      }

      if (resolution.status === 'not_found') {
        setUrlNotice({
          message: resolution.noticeMessage || '요청하신 항목을 찾을 수 없습니다.',
          entity: resolution.notFoundEntity,
        });
        return;
      }

      // An unknown tab value is normalized safely, but the user is told so the
      // URL and the shown screen never silently disagree.
      setUrlNotice(
        resolution.status === 'invalid_tab'
          ? { message: '알 수 없는 탭 주소라 기본 화면으로 이동했습니다.' }
          : null
      );
      if (resolution.subjectId && resolution.subjectId !== activeSubjectId) {
        setActiveSubjectId(resolution.subjectId);
      }
      setActiveTab(resolution.tab);

      if (resolution.materialId) {
        const mat = materials.find((m) => m.id === resolution.materialId);
        if (mat) {
          setEditingMaterial(mat);
          setIsMaterialEditorOpen(true);
        }
      }

      if (resolution.problemId) {
        setActiveProblemIdForSession(resolution.problemId);
        if (resolution.tab === 'session') {
          setIsProblemSessionOpen(true);
        }
      }

      if (resolution.attemptId) {
        setSelectedAttemptId(resolution.attemptId);
      }

      if (resolution.tab === 'exam') {
        // Keep the exact exam id so the screen opens THAT session, not merely
        // whichever session the subject happens to have active.
        setExamIdFromUrl(resolution.examId ?? null);
        setIsMockExamModalOpen(true);
      } else {
        setExamIdFromUrl(null);
      }
    };

    syncFromUrl();
    window.addEventListener('popstate', syncFromUrl);
    return () => window.removeEventListener('popstate', syncFromUrl);
  }, [isLoaded, cloudStatus, subjects, materials, allProblems, attempts, mockExams, activeSubjectId]);

  // Add Subject Handler (Stage 0) — persists to Supabase first.
  const handleAddSubject = async (newSubject: Subject) => {
    const result = await upsertSubject(newSubject);
    if (!result.ok) {
      showToast(`과목 저장 실패: ${result.error}`);
      return;
    }
    const updated = [...subjects, result.data];
    setSubjects(updated);
    saveStoredSubjects(updated);
    handleSelectSubject(result.data.id);
    showToast(`새 과목 폴더 [${result.data.name}]이 생성되었습니다.`);
  };

  // Concept Selection Handler
  const handleSelectConcept = (conceptId: string) => {
    setSelectedConceptId(conceptId);
    const c = subjectConcepts.find((item) => item.id === conceptId);
    if (c && c.events.length > 0) {
      // Pick last event
      const lastEvent = c.events[c.events.length - 1];
      setSelectedEventId(lastEvent.id);
    } else {
      setSelectedEventId(null);
    }
  };

  // Toggle Compare Concept (up to 3)
  const handleToggleCompareConcept = (conceptId: string) => {
    if (comparedConceptIds.includes(conceptId)) {
      setComparedConceptIds(comparedConceptIds.filter((id) => id !== conceptId));
    } else {
      if (comparedConceptIds.length >= 3) {
        showToast('비교 모드는 최대 3개 개념까지 선택할 수 있습니다.');
        return;
      }
      setComparedConceptIds([...comparedConceptIds, conceptId]);
    }
  };

  // Subject Update Handler (Schedule, Scope, etc.) — persists to Supabase first.
  const handleUpdateSubject = async (updated: Subject) => {
    const result = await upsertSubject(updated);
    if (!result.ok) {
      showToast(`과목 정보 저장 실패: ${result.error}`);
      return;
    }
    const newSubjects = subjects.map((s) => (s.id === result.data.id ? result.data : s));
    setSubjects(newSubjects);
    saveStoredSubjects(newSubjects);
    showToast('과목 시험 정보가 성공적으로 갱신되었습니다.');
  };

  // Material Add Handler — LOCAL-FIRST by default.
  //  1. body -> IndexedDB, original -> IndexedDB (verified)
  //  2. cloud metadata-only, unless the policy opts into body sync / original backup
  // Returns true only after the local saves AND the cloud metadata write succeed.
  const handleAddMaterial = async (
    newMat: Material,
    originalFile?: File,
    jobId?: string
  ): Promise<boolean> => {
    const policy = newMat.storagePolicy ?? loadDefaultMaterialPolicy();
    const content = {
      markdown: newMat.parsedMarkdown ?? '',
      rawText: newMat.rawText,
      pages: newMat.pages,
    };

    // 1. Local body (IndexedDB) — a core part of the local-first policy.
    const bodySave = await saveMaterialContent(newMat.id, content);
    if (!bodySave.persisted) {
      showToast(`자료 본문을 이 기기에 저장하지 못했습니다: ${bodySave.error}`);
      return false;
    }
    if (content.markdown) {
      recordMaterialBodyHash(newMat.id, computeMarkdownHash(content.markdown), {
        subjectId: newMat.subjectId,
        kind: newMat.kind,
      });
      clearDeletedMaterialMarker(newMat.id);
    }

    // 2. Local original (IndexedDB) when a file was provided.
    let originalHash = newMat.originalHash;
    let fileSize = newMat.fileSize;
    if (originalFile) {
      const savedOriginal = await saveMaterialOriginal(
        newMat.id,
        originalFile,
        originalFile.type || 'application/pdf'
      );
      if (!savedOriginal.persisted) {
        showToast(`원본 파일을 이 기기에 저장하지 못했습니다: ${savedOriginal.error}`);
        return false;
      }
      originalHash = savedOriginal.hash;
      fileSize = savedOriginal.size;
    }
    const materialToStore: Material = {
      ...newMat,
      storagePolicy: policy,
      originalHash,
      fileSize,
      bodyHash: newMat.bodyHash ?? (content.markdown ? computeMarkdownHash(content.markdown) : undefined),
    };
    clearDeletedMaterialMarker(newMat.id);

    // 3. Cloud: metadata-only unless the policy explicitly opts in.
    const uploadBody = policy.syncBody;
    const uploadOriginal = policy.backupOriginal && Boolean(originalFile);
    const result = uploadBody || uploadOriginal
      ? await writeMaterial({
          material: materialToStore,
          content,
          original: uploadOriginal
            ? { blob: originalFile as File, contentType: originalFile!.type || 'application/pdf' }
            : null,
          jobId,
          policy,
        })
      : await writeMaterialMetadata({ material: materialToStore, bodySynced: false, originalBackedUp: false });
    if (!result.ok) {
      showToast(`자료 서버 등록 실패: ${result.error}`);
      return false;
    }

    const fallbackUsed = Boolean(
      'fallbackUsed' in result.data
        ? (result.data as { fallbackUsed?: boolean }).fallbackUsed
        : (result.data as unknown as Record<string, unknown>).fallback_used
    );

    // Sync state: only a server-confirmed body upload (syncBody) is 'confirmed'.
    if (uploadBody && !fallbackUsed) {
      const bodyContentHash = materialContentHash(content);
      recordMaterialSyncState(newMat.id, {
        serverBodyHash: bodyContentHash,
        serverHasBody: true,
        localBodyHash: bodyContentHash,
        status: 'confirmed',
      });
    } else if (uploadBody && fallbackUsed) {
      recordMaterialSyncState(newMat.id, {
        localBodyHash: materialContentHash(content),
        status: 'pending',
      });
    } else {
      recordMaterialSyncState(newMat.id, {
        localBodyHash: materialContentHash(content),
        status: 'not_required',
      });
    }

    const updated = [materialToStore, ...materials];
    setMaterials(updated);
    saveStoredMaterials(updated);
    if (fallbackUsed) {
      showToast(
        `자료 [${newMat.title}]가 저장되었으나 서버 마이그레이션 9 미적용으로 저장 정책/해시는 서버에 저장되지 않았습니다.`
      );
    } else {
      showToast(
        uploadBody || uploadOriginal
          ? `자료 [${newMat.title}]가 이 기기와 서버에 저장되었습니다.`
          : `자료 [${newMat.title}]가 이 기기에 저장되었습니다. (서버에는 연결 메타데이터만 저장)`
      );
    }
    return true;
  };

  // Stage 2: AI Concept Analysis Handler
  const handleTriggerAiAnalysis = async (targetMaterial: Material) => {
    // Hydrate the body from this device's IndexedDB when the local cache lacks it
    // (e.g. metadata-only on another device). Missing content = reconnect needed,
    // never corruption.
    let markdown = targetMaterial.parsedMarkdown;
    if (!markdown || !markdown.trim()) {
      const loaded = await loadMaterialContent(targetMaterial.id);
      markdown = loaded?.markdown;
    }
    if (!markdown || !markdown.trim()) {
      showToast('이 기기에 자료 본문이 없습니다. 자료 화면에서 파일을 다시 연결해 주세요.');
      return;
    }
    if (targetMaterial.status !== 'ready') {
      showToast('자료가 아직 변환 중이거나 오류 상태입니다. 저장 완료 후 분석할 수 있습니다.');
      return;
    }

    setIsAiAnalyzing(true);
    showToast(`[${targetMaterial.title}] AI 개념 분석 시작... (AI 처리 중)`);

    try {
      const res = await fetch('/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: targetMaterial.id,
          subjectId: targetMaterial.subjectId,
          domain: activeSubject?.domain || 'mathematics',
          markdown,
          sourceRefs: targetMaterial.sourceRefs || [],
          materialTitle: targetMaterial.title,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        const errMsg = data.error || 'AI 개념 분석에 실패했습니다.';
        const details = data.details ? ` (${data.details})` : '';
        showToast(`분석 실패: ${errMsg}${details}`);
        return;
      }

      let newDrafts: ConceptDraft[] = data.drafts || [];
      if (newDrafts.length === 0) {
        showToast('추출된 새로운 개념이 없습니다.');
        return;
      }

      if (data.persisted === false) {
        // Retry saving the already-generated drafts WITHOUT re-calling the AI.
        try {
          const retry = await fetch('/api/persist-drafts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'concept', generationJobId: data.generationJobId, drafts: newDrafts }),
          });
          const retryData = await retry.json();
          if (!retry.ok || !retryData.persisted) {
            showToast(
              `개념 초안을 서버에 저장하지 못했습니다. 로컬에 보관했으며 다시 시도할 수 있습니다. (${data.persistError || retryData.error || '오류'})`
            );
          } else if (Array.isArray(retryData.drafts)) {
            // Adopt the server drafts (DB updatedAt/contentVersion/approval).
            newDrafts = retryData.drafts as ConceptDraft[];
          }
        } catch {
          showToast('개념 초안 서버 저장 재시도에 실패했습니다. 로컬에 보관되어 있습니다.');
        }
      }

      // Replace or prepend drafts for this material, preserving drafts for other materials
      const otherDrafts = conceptDrafts.filter((d) => d.materialId !== targetMaterial.id);
      const updatedDrafts = [...newDrafts, ...otherDrafts];
      setConceptDrafts(updatedDrafts);
      saveStoredConceptDrafts(updatedDrafts);

      // Update material hasAiConcepts flag
      const updatedMaterials = materials.map((m) =>
        m.id === targetMaterial.id ? { ...m, hasAiConcepts: true } : m
      );
      setMaterials(updatedMaterials);
      saveStoredMaterials(updatedMaterials);

      // Select and open review modal
      setConceptReviewMaterial(targetMaterial);
      setIsConceptReviewOpen(true);
      showToast(`[${targetMaterial.title}] 분석 완료! ${newDrafts.length}개 개념 초안이 생성되었습니다.`);
    } catch (err) {
      showToast(`네트워크 또는 서버 오류: ${err instanceof Error ? err.message : '알 수 없는 오류'}`);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  // Stage 3: AI Problem Generation & Review Handlers
  const handleProblemGenerateSuccess = (newDrafts: ProblemDraft[]) => {
    const otherDrafts = problemDrafts.filter((d) => !newDrafts.some((nd) => nd.id === d.id));
    const updated = [...newDrafts, ...otherDrafts];
    setProblemDrafts(updated);
    saveStoredProblemDrafts(updated);

    // Update material hasAiProblems flag if material exists
    const targetMaterial = materials.find((m) => m.subjectId === activeSubject?.id);
    if (targetMaterial && !targetMaterial.hasAiProblems) {
      const updatedMaterials = materials.map((m) =>
        m.id === targetMaterial.id ? { ...m, hasAiProblems: true } : m
      );
      setMaterials(updatedMaterials);
      saveStoredMaterials(updatedMaterials);
    }

    setIsProblemReviewOpen(true);
    showToast(`AI 고난도 문제 ${newDrafts.length}건이 성공적으로 생성되었습니다. 검토를 진행해 주세요.`);
  };

  // Approval outcome: 'ok' (server confirmed + refetched), 'partial' (server
  // approved but the screen could not be reconciled), or 'error'.
  type ApprovalOutcome<T, L> = {
    status: 'ok' | 'partial' | 'error';
    error?: string;
    title?: string;
    entities: T[];
    drafts: L[];
  };

  // Approves one problem draft through the transactional server RPC, then
  // RE-READS the confirmed entity + draft from the server. The local candidate
  // is never used as the approval result.
  const approveProblemViaServer = async (
    draftId: string,
    problems: Problem[],
    drafts: ProblemDraft[]
  ): Promise<ApprovalOutcome<Problem, ProblemDraft>> => {
    const draft = drafts.find((d) => d.id === draftId);
    if (!draft) return { status: 'error', error: '초안을 찾을 수 없습니다.', entities: problems, drafts };
    const existing = problems.find((p) => p.draftId === draftId);
    const built = buildProblemFromDraft(draft, existing, new Date().toISOString());
    try {
      const supabase = createBrowserSupabaseClient();
      const rpc = await approveProblemDraftCloud(supabase, draft, built, draft.updatedAt ?? null);
      if (!rpc.ok) return { status: 'error', error: rpc.error, entities: problems, drafts };
      const [fetched, fetchedDraft] = await Promise.all([
        getProblemById(supabase, rpc.data.id),
        getProblemDraftById(supabase, draftId),
      ]);
      if (!fetched.ok || !fetched.data) {
        return {
          status: 'partial',
          error: '서버 승인은 완료됐지만 화면 갱신에 실패했습니다. 새로고침해 주세요.',
          entities: problems,
          drafts,
        };
      }
      const approvedProblem = fetched.data;
      const nextProblems = existing
        ? problems.map((p) => (p.draftId === draftId ? approvedProblem : p))
        : [...problems, approvedProblem];
      const nextDrafts =
        fetchedDraft.ok && fetchedDraft.data
          ? drafts.map((d) => (d.id === draftId ? (fetchedDraft.data as ProblemDraft) : d))
          : drafts;
      return { status: 'ok', title: approvedProblem.title, entities: nextProblems, drafts: nextDrafts };
    } catch (e) {
      return {
        status: 'error',
        error: e instanceof Error ? e.message : '문제 승인에 실패했습니다.',
        entities: problems,
        drafts,
      };
    }
  };

  // Approves one concept draft through the server RPC, then re-reads it.
  const approveConceptViaServer = async (
    draft: ConceptDraft,
    concepts: Concept[],
    drafts: ConceptDraft[]
  ): Promise<ApprovalOutcome<Concept, ConceptDraft>> => {
    const existing = concepts.find((c) => c.draftId === draft.id);
    const order = existing
      ? existing.order
      : concepts.filter((c) => c.subjectId === draft.subjectId).length + 1;
    const built = buildConceptFromDraft(draft, existing, order);
    try {
      const supabase = createBrowserSupabaseClient();
      const rpc = await approveConceptDraftCloud(supabase, draft, built, draft.updatedAt ?? null);
      if (!rpc.ok) return { status: 'error', error: rpc.error, entities: concepts, drafts };
      const [fetched, fetchedDraft] = await Promise.all([
        getConceptById(supabase, rpc.data.id),
        getConceptDraftById(supabase, draft.id),
      ]);
      if (!fetched.ok || !fetched.data) {
        return {
          status: 'partial',
          error: '서버 승인은 완료됐지만 화면 갱신에 실패했습니다. 새로고침해 주세요.',
          entities: concepts,
          drafts,
        };
      }
      const approvedConcept = fetched.data;
      const nextConcepts = existing
        ? concepts.map((c) => (c.draftId === draft.id ? approvedConcept : c))
        : [...concepts, approvedConcept];
      const nextDrafts =
        fetchedDraft.ok && fetchedDraft.data
          ? drafts.map((d) => (d.id === draft.id ? (fetchedDraft.data as ConceptDraft) : d))
          : drafts;
      return { status: 'ok', title: approvedConcept.title, entities: nextConcepts, drafts: nextDrafts };
    } catch (e) {
      return {
        status: 'error',
        error: e instanceof Error ? e.message : '개념 승인에 실패했습니다.',
        entities: concepts,
        drafts,
      };
    }
  };

  const approvalErrorMessage = (error?: string): string => {
    if (!error) return '문제 승인에 실패했습니다.';
    if (error.startsWith('not_pending')) return '이미 승인된 초안입니다.';
    if (error.startsWith('stale')) return '다른 곳에서 초안이 수정되었습니다. 새로고침 후 다시 시도하세요.';
    if (error.startsWith('rubric')) return '루브릭 합계가 100점이 아닙니다. 서버 검증에 실패했습니다.';
    if (error.startsWith('no_concept')) return '연결된 개념이 없습니다.';
    if (error.startsWith('incomplete')) return '필수 항목(제목·문제·모범답안)이 누락되었습니다.';
    if (error.startsWith('missing')) return '초안을 찾을 수 없습니다.';
    return `문제 승인 실패: ${error}`;
  };

  const handleApproveProblemDraft = async (draftId: string) => {
    const result = await approveProblemViaServer(draftId, allProblems, problemDrafts);
    if (result.status === 'ok') {
      setAllProblems(result.entities);
      saveStoredProblems(result.entities);
      setProblemDrafts(result.drafts);
      saveStoredProblemDrafts(result.drafts);
      showToast(`문제 [${result.title}]이(가) 서버에 승인되어 풀이 목록에 등록되었습니다.`);
    } else if (result.status === 'partial') {
      showToast(result.error ?? '서버 승인은 완료됐지만 화면 갱신에 실패했습니다. 새로고침해 주세요.');
    } else {
      showToast(approvalErrorMessage(result.error));
    }
  };

  const handleBatchApproveProblemDrafts = async (draftIds: string[]) => {
    let problems = allProblems;
    let drafts = problemDrafts;
    let approvedCount = 0;
    let failed = 0;
    let partial = 0;
    for (const draftId of draftIds) {
      const result = await approveProblemViaServer(draftId, problems, drafts);
      if (result.status === 'ok') {
        problems = result.entities;
        drafts = result.drafts;
        approvedCount += 1;
      } else if (result.status === 'partial') {
        // Server approved but the screen could not be reconciled.
        partial += 1;
      } else {
        // A failed candidate never contaminates later items.
        failed += 1;
      }
    }
    setAllProblems(problems);
    saveStoredProblems(problems);
    setProblemDrafts(drafts);
    saveStoredProblemDrafts(drafts);
    if (failed > 0 || partial > 0) {
      showToast(`${approvedCount}건 승인 완료, 실패 ${failed}건·부분 ${partial}건. 해당 항목을 새로고침 후 확인해 주세요.`);
    } else {
      showToast(`선택한 문제 ${approvedCount}건이 서버에 승인 완료되었습니다.`);
    }
  };

  // Best-effort server sync for locally-managed problem writes. Reports a
  // warning (never a false success) when the server rejects the change.
  const pushProblemToServer = async (
    problemId: string,
    opts: { revise?: boolean; expectedVersion?: number } = {}
  ): Promise<void> => {
    const problem = loadStoredProblems().find((p) => p.id === problemId);
    if (!problem) return;
    try {
      const supabase = createBrowserSupabaseClient();
      const result = opts.revise
        ? await reviseProblem(
            supabase,
            problemId,
            opts.expectedVersion ?? Math.max(1, (problem.version ?? 1) - 1),
            problem
          )
        : await updateProblemQuality(supabase, problemId, {
            qualityStatus: problem.qualityStatus,
            isOutdated: problem.isOutdated,
            needsSourceReview: problem.needsSourceReview,
            payload: problem as unknown as Record<string, unknown>,
          });
      if (!result.ok) showToast(`서버 동기화 실패: ${result.error}`);
    } catch (e) {
      showToast(`서버 동기화 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    }
  };

  const handleUpdateProblemDraft = async (updatedDraft: ProblemDraft) => {
    // Drafts loaded from the server carry contentVersion; local-only drafts do not.
    if (updatedDraft.contentVersion !== undefined) {
      try {
        const supabase = createBrowserSupabaseClient();
        const result = await updateProblemDraftCloud(supabase, updatedDraft, updatedDraft.contentVersion);
        if (!result.ok) {
          showToast(`문제 초안 수정 저장 실패: ${result.error}`);
          return;
        }
        const next = problemDrafts.map((d) => (d.id === result.data.id ? result.data : d));
        setProblemDrafts(next);
        saveStoredProblemDrafts(next);
        showToast('문제 초안 수정 내용이 서버에 저장되었습니다.');
        return;
      } catch (e) {
        showToast(`문제 초안 수정 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
        return;
      }
    }
    const updated = updateProblemDraft(updatedDraft);
    setProblemDrafts(updated);
    showToast('문제 초안 수정 내용이 로컬에 저장되었습니다. (아직 서버에 이전되지 않음)');
  };

  const handleDeleteProblemDraft = async (draftId: string) => {
    const draft = problemDrafts.find((d) => d.id === draftId);
    if (draft?.contentVersion !== undefined) {
      try {
        const supabase = createBrowserSupabaseClient();
        const result = await deleteProblemDraftCloud(supabase, draftId);
        if (!result.ok) {
          showToast(`문제 초안 삭제 실패: ${result.error}`);
          return;
        }
      } catch (e) {
        showToast(`문제 초안 삭제 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
        return;
      }
    }
    const updated = problemDrafts.filter((d) => d.id !== draftId);
    setProblemDrafts(updated);
    saveStoredProblemDrafts(updated);
    showToast('문제 초안이 삭제되었습니다.');
  };

  const handleStartPracticeFromDraft = async (draft: ProblemDraft) => {
    let problemToPracticeId = '';
    if (!draft.isApproved) {
      // Approve on the server first (unapproved drafts are never exposed as
      // practice targets), then start practice with the confirmed problem.
      const result = await approveProblemViaServer(draft.id, allProblems, problemDrafts);
      if (result.status === 'ok') {
        setProblemDrafts(result.drafts);
        saveStoredProblemDrafts(result.drafts);
        setAllProblems(result.entities);
        saveStoredProblems(result.entities);
        const approved = result.entities.find((p) => p.draftId === draft.id);
        problemToPracticeId = approved?.id ?? '';
      } else {
        showToast(
          result.status === 'partial'
            ? result.error ?? '서버 승인은 완료됐지만 화면 갱신에 실패했습니다. 새로고침해 주세요.'
            : approvalErrorMessage(result.error)
        );
        return;
      }
    } else {
      const existing = allProblems.find((p) => p.draftId === draft.id);
      if (existing) {
        problemToPracticeId = existing.id;
      }
    }

    if (draft.conceptIds && draft.conceptIds.length > 0) {
      setSelectedConceptId(draft.conceptIds[0]);
    }
    setSelectedProblemType(draft.type);
    if (problemToPracticeId) {
      setActiveProblemIdForSession(problemToPracticeId);
    }
    setIsProblemReviewOpen(false);
    openProblemSessionScreen(problemToPracticeId || undefined);
  };

  // Stage 6: Problem Quality, Reporting, Review, Revision & Re-approval Handlers
  const handleReportProblem = (
    problemId: string,
    reportData: { type: ProblemReportType; details: string; attemptId?: string }
  ) => {
    const res = reportProblemError(problemId, reportData);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId);
      showToast('문제 오류가 신고되었습니다. 품질 검토 및 수정 완료 시까지 출제에서 제외됩니다.');
    } else {
      showToast(`신고 접수 실패: ${res.error}`);
    }
    return res;
  };

  const handleUpdateProblemQualityStatus = (
    problemId: string,
    newStatus: ProblemQualityStatus,
    note?: string
  ) => {
    const updated = updateProblemQualityStatus(problemId, newStatus, note);
    if (updated) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId);
      showToast(`문제 상태가 [${newStatus}]으로 변경되었습니다.`);
    }
  };

  const handleDismissProblemReport = (
    problemId: string,
    reportId: string,
    dismissReason: string
  ) => {
    const res = dismissProblemReport(problemId, reportId, dismissReason);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId);
      showToast('신고가 기각 사유와 함께 종결 처리되었습니다.');
    } else {
      showToast(`신고 기각 실패: ${res.error}`);
    }
    return res;
  };

  const handleReviseProblem = (
    problemId: string,
    updates: Partial<Problem>,
    editReason: string
  ) => {
    const beforeVersion = allProblems.find((p) => p.id === problemId)?.version ?? 1;
    const res = editAndReviseProblem(problemId, updates, editReason);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId, { revise: true, expectedVersion: beforeVersion });
      showToast('문제가 수정되어 새 버전으로 기록되었습니다. (수정 후 재검토 상태)');
    } else {
      showToast(`문제 수정 실패: ${res.error}`);
    }
    return res;
  };

  const handleReapproveProblem = (problemId: string, reapprovalNote?: string) => {
    const beforeVersion = allProblems.find((p) => p.id === problemId)?.version ?? 1;
    const res = reapproveProblem(problemId, reapprovalNote, materials);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId, { revise: true, expectedVersion: beforeVersion });
      showToast('문제 품질 검토 및 재승인이 완료되어 다시 출제에 포함됩니다.');
    } else {
      showToast(`재승인 실패: ${res.error}`);
    }
    return res;
  };

  const handleSuspendProblem = (problemId: string, suspensionReason?: string) => {
    const suspended = suspendProblem(problemId, suspensionReason);
    if (suspended) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      void pushProblemToServer(problemId);
      showToast('문제가 사용 중지 처리되었습니다.');
    }
  };

  // Attempt Submission Handler (Updates ReviewEvent & Retention Score)
  // Returns a structured outcome so the caller can distinguish retryable failures
  // from linkage conflicts/targets that the user must resolve.
  const handleSubmitAttempt = (attempt: Attempt): {
    partial: boolean;
    status: AttemptSaveStatus;
    attemptPersisted: boolean;
    eventPersisted: boolean;
    message?: string;
  } => {
    const result = recordAttemptAndUpdateConcept(attempt, settings, { planItemId: attempt.planItemId });

    const { updatedConcepts, updatedAttempts } = result;
    setAllConcepts(updatedConcepts);
    setAttempts(updatedAttempts);
    setStudyPlanItems(loadStoredStudyPlanItems()); // Sync Stage 9 plan items

    // Set selected event to the newly added event
    const updatedConcept = updatedConcepts.find((c) => c.id === attempt.conceptId);
    if (updatedConcept && updatedConcept.events.length > 0) {
      const newEvent = updatedConcept.events[updatedConcept.events.length - 1];
      setSelectedEventId(newEvent.id);
    }

    // Server sync (idempotent by attempt id). Local persistence already holds
    // the result, but a server failure is surfaced, never reported as success.
    // The scope is pinned so a late response is never applied to another account.
    const scopeAtSubmit = getStorageScopeId();
    const applyIfSameScope = (fn: () => void) => {
      if (getStorageScopeId() === scopeAtSubmit) fn();
    };
    const syncEvent = updatedConcept?.events.find((e) => e.attemptId === attempt.id);
    if (syncEvent && isSupabaseConfigured()) {
      // Pass the validated review round of the linked plan item so the server
      // can refuse to complete a plan whose round does not match.
      const linkedItem = attempt.planItemId
        ? loadStoredStudyPlanItems().find((i) => i.id === attempt.planItemId)
        : undefined;
      const planRound = linkedItem?.round ?? null;
      void (async () => {
        try {
          const supabase = createBrowserSupabaseClient();
          const submitted = await submitAttemptCloud(
            supabase,
            attempt,
            syncEvent,
            attempt.planItemId ?? null,
            planRound
          );
          if (!submitted.ok) {
            applyIfSameScope(() =>
              showToast(`풀이는 로컬에 저장됐지만 서버 저장에 실패했습니다: ${submitted.error}`)
            );
            return;
          }
          // Attempt persistence and plan linkage are distinct outcomes.
          const planStatus = submitted.data.planStatus;
          if (planStatus === 'PLAN_ITEM_MISMATCH' || planStatus === 'PLAN_ITEM_NOT_FOUND' || planStatus === 'PLAN_ITEM_SKIPPED') {
            applyIfSameScope(() =>
              showToast('풀이는 저장됐지만 계획 연결은 반영되지 않았습니다. 올바른 계획을 선택해 다시 시도해 주세요.')
            );
          } else if (planStatus === 'PLAN_ITEM_COMPLETED_BY_OTHER') {
            applyIfSameScope(() =>
              showToast('이 계획은 다른 풀이로 이미 완료되어 기존 완료 기록을 유지했습니다.')
            );
          }
        } catch (e) {
          applyIfSameScope(() =>
            showToast(`풀이 서버 저장 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`)
          );
        }
      })();
    }

    // A plan linkage conflict/missing target takes precedence: the record is saved
    // but the plan link must be resolved by the user (no blind retry loop).
    if (result.status === 'link_conflict' || result.status === 'target_missing' || result.status === 'retryable_failure') {
      return {
        partial: true,
        status: result.status,
        attemptPersisted: result.attemptPersisted,
        eventPersisted: result.eventPersisted,
        message: result.message,
      };
    }

    // Reservation completion only after the critical record is verified persisted.
    if (result.attemptPersisted && result.eventPersisted && attempt.rechallengeReservationId) {
      const completion = completeRechallengeReservation(attempt.rechallengeReservationId, {
        attemptId: attempt.id,
        subjectId: attempt.subjectId,
        conceptId: attempt.conceptId,
        problemId: attempt.problemId,
        problemVersion: attempt.problemVersion,
      });
      setRechallengeReservations(completion.reservations);

      const reservationOutcome = handleReservationCompletionOutcome(completion);
      if (!reservationOutcome.isSuccess && reservationOutcome.partialOutcome) {
        return reservationOutcome.partialOutcome;
      }
      if (reservationOutcome.toastMessage) {
        showToast(reservationOutcome.toastMessage);
      }
    } else if (result.status === 'already_completed') {
      showToast('이미 기록된 풀이입니다.');
    } else {
      showToast(`복습 제출 완료! 모델 점수가 ${attempt.calculatedScore}점으로 즉시 갱신되었습니다.`);
    }
    return {
      partial: false,
      status: result.status,
      attemptPersisted: result.attemptPersisted,
      eventPersisted: result.eventPersisted,
    };
  };

  // Stage 13: Answer-logic strengthening handlers
  const handleOpenLogicStrengthen = (attempt: Attempt) => {
    const concept = allConcepts.find((c) => c.id === attempt.conceptId);
    const problem = allProblems.find((p) => p.id === attempt.problemId);
    if (!concept || !problem) {
      showToast('연결된 개념 또는 문제를 찾을 수 없어 논리 강화를 시작할 수 없습니다.');
      return;
    }
    const subj = subjects.find((s) => s.id === attempt.subjectId);
    const subjConcepts = allConcepts.filter((c) => c.subjectId === attempt.subjectId);
    const ranking = rankConceptsForReview(subjConcepts, settings, subj?.examAt, new Date(), intervalMultiplier);
    const rec = ranking.rankedRecommendations.find((r) => r.conceptId === attempt.conceptId);
    setLogicRecommendationDate(rec?.recommendedDateStr ?? null);
    setLogicTarget({ attempt, concept, problem });
  };

  const handleRecordAssistedAttempt = (attempt: Attempt) => {
    const { updatedConcepts, updatedAttempts } = recordAssistedRevisionAttempt(attempt);
    setAllConcepts(updatedConcepts);
    setAttempts(updatedAttempts);
    showToast('보완 답안이 원본과 연결된 별도 기록으로 저장되었습니다. (원본 불변, 독립 성과 아님)');
  };

  const handleReserveRechallenge = (reservation: RechallengeReservation): boolean => {
    const ok = saveRechallengeReservation(reservation);
    if (!ok) {
      showToast('재도전 예약 저장에 실패했습니다. 다시 시도해 주세요.');
      return false;
    }
    setRechallengeReservations(loadRechallengeReservations());
    showToast(`재도전이 ${reservation.scheduledDate}에 예약되었습니다. 점수·복습 회차는 변경되지 않습니다.`);
    return true;
  };

  const handleUpdateReservation = (reservationId: string, scheduledDate: string): boolean => {
    const { saved } = updateRechallengeReservation(reservationId, { scheduledDate });
    if (!saved) {
      showToast('예약 날짜 변경 저장에 실패했습니다.');
      return false;
    }
    setRechallengeReservations(loadRechallengeReservations());
    showToast(`재도전 예약 날짜가 ${scheduledDate}로 변경되었습니다.`);
    return true;
  };

  const handleCancelReservation = (reservationId: string): boolean => {
    const { saved } = cancelRechallengeReservation(reservationId);
    if (!saved) {
      showToast('예약 취소 저장에 실패했습니다.');
      return false;
    }
    setRechallengeReservations(loadRechallengeReservations());
    showToast('재도전 예약이 취소되었습니다. 점수·복습 회차는 변경되지 않았습니다.');
    return true;
  };

  const handleSaveTransferDraft = (draft: ProblemDraft): boolean => {
    try {
      const updated = [draft, ...problemDrafts.filter((d) => d.id !== draft.id)];
      saveStoredProblemDrafts(updated);
      // Verify the exact content/version we tried to save (not just the id).
      const persisted = loadStoredProblemDrafts().find((d) => d.id === draft.id);
      if (
        !persisted ||
        persisted.updatedAt !== draft.updatedAt ||
        persisted.promptText !== draft.promptText ||
        persisted.logicSessionId !== draft.logicSessionId
      ) {
        return false;
      }
      setProblemDrafts(updated);
      showToast('전이 문제 초안이 저장되었습니다. 문제 검토·승인 화면에서 검토해 주세요.');
      return true;
    } catch {
      return false;
    }
  };

  const handleStartTransferProblem = (transferProblem: Problem) => {
    if (transferProblem.subjectId !== activeSubjectId) {
      setActiveSubjectId(transferProblem.subjectId);
      saveActiveSubjectId(transferProblem.subjectId);
    }
    if (transferProblem.conceptIds[0]) setSelectedConceptId(transferProblem.conceptIds[0]);
    setSelectedProblemType(transferProblem.type);
    setActiveProblemIdForSession(transferProblem.id);
    setLogicTarget(null);
    openProblemSessionScreen(transferProblem.id);
    showToast('전이 문제를 시작합니다. 모범답안은 제출 전까지 표시되지 않습니다.');
  };

  // Stage 9: Study Plan Handlers
  const handleStartPlanItem = (item: StudyPlanItem) => {
    // Switch to the item's own subject first so subject-scoped modals (problem
    // session, generator, mock exam, source viewer) open with the right subject.
    if (item.subjectId !== activeSubjectId) {
      setActiveSubjectId(item.subjectId);
      saveActiveSubjectId(item.subjectId);
    }

    if (item.needsProblemGeneration) {
      if (item.conceptId) {
        setSelectedConceptId(item.conceptId);
      }
      setIsStudyPlanOpen(false);
      setIsProblemGeneratorOpen(true);
      showToast('승인된 문제가 부족하여 문제 출제 화면으로 이동합니다.');
      return;
    }

    if (item.kind === 'initial_study') {
      const concept = allConcepts.find((c) => c.id === item.conceptId);
      setIsStudyPlanOpen(false);
      if (concept?.chapterRef) {
        setPdfViewerSourceRef(concept.chapterRef);
      } else {
        setIsMaterialsListOpen(true);
      }
      showToast(`[${item.conceptName || '개념'}] 원문 및 핵심 정리 학습을 시작합니다.`);
      return;
    }

    if (item.kind === 'mixed_mock_exam') {
      // 계획에 저장된 범위·유형·시간 설정을 모의시험 모달로 전달한다.
      setMockExamInitialConfig({
        conceptIds: item.mockExamConfig?.conceptIds ?? item.conceptIds ?? [],
        selectedTypes: item.mockExamConfig?.selectedTypes,
        minutes: item.mockExamConfig?.minutes ?? item.estimatedMinutes,
        planItemId: item.id,
        planItemTitle: item.snapshotTitle,
      });
      setIsStudyPlanOpen(false);
      setIsMockExamModalOpen(true);
      showToast(`[${item.subjectName}] 실전 모의시험을 시작합니다.`);
      return;
    }

    // rechallenge: 지연 재도전은 원답안/보완 답안을 가리고 독립적으로 다시 푼다.
    if (item.kind === 'rechallenge') {
      const prob = item.problemId ? allProblems.find((p) => p.id === item.problemId) : undefined;
      if (!prob || !isProblemAvailableForPractice(prob)) {
        showToast('재도전 문제를 사용할 수 없습니다. 문제를 재생성하거나 예약을 조정해 주세요.');
        return;
      }
      // 예약 이후 문제 버전이 바뀌면 알리고 확인을 받는다.
      if (item.rechallengeId) {
        const reservation = getRechallengeReservation(item.rechallengeId);
        const currentVersion = prob.version ?? 1;
        if (reservation && reservation.problemVersion !== currentVersion) {
          if (
            !window.confirm(
              `예약 당시 문제 버전(v${reservation.problemVersion})과 현재 버전(v${currentVersion})이 다릅니다. 현재 버전으로 풀어도 될까요?`
            )
          ) {
            return;
          }
        }
      }
      if (item.conceptId) setSelectedConceptId(item.conceptId);
      if (item.problemType) setSelectedProblemType(item.problemType);
      setActiveProblemIdForSession(item.problemId || null);
      setActiveRechallengeReservationId(item.rechallengeId || null);
      setActivePlanItemIdForSession(item.id);
      setIsStudyPlanOpen(false);
      setIsProblemSessionOpen(true);
      showToast('지연 재도전: 원답안·보완 답안을 가리고 새 답안을 먼저 작성하세요.');
      return;
    }

    // recommended_review or vulnerability_fix
    if (item.problemId) {
      const prob = allProblems.find((p) => p.id === item.problemId);
      if (prob && !isProblemAvailableForPractice(prob)) {
        showToast('해당 문제는 현재 오류 신고 검토 중으로 출제에서 제외되었습니다. 검토를 완료하거나 새 문제를 생성해 주세요.');
        return;
      }
      if (item.conceptId) {
        setSelectedConceptId(item.conceptId);
      }
      if (item.problemType) {
        setSelectedProblemType(item.problemType);
      }
      setActiveProblemIdForSession(item.problemId);
      setActiveRechallengeReservationId(null);
      setActivePlanItemIdForSession(item.id);
      setIsStudyPlanOpen(false);
      setIsProblemSessionOpen(true);
      showToast(`[${item.problemTitle || '문제'}] 풀이를 시작합니다.`);
    }
  };

  const handleResumeMockExam = () => {
    setMockExamInitialConfig(null);
    // Resuming from a CTA/menu is not a deep link: use the subject's active session.
    setExamIdFromUrl(null);
    setIsMockExamModalOpen(true);
  };

  const handleStartTodayPrimary = () => {
    if (!primaryCta) return;
    if (primaryCta.kind === 'resume-mock') {
      handleResumeMockExam();
      return;
    }
    const item = todayDigest.items.find((i) => i.id === primaryCta.itemId);
    if (item) handleStartPlanItem(item);
  };

  // Mirror a single study-plan item change to the server without ever reverting
  // a completion recorded on another device.
  const syncPlanItemToServer = async (item: StudyPlanItem, actionLabel: string) => {
    if (!isSupabaseConfigured()) return;
    try {
      const supabase = createBrowserSupabaseClient();
      const result = await saveStudyPlanItem(supabase, item);
      if (!result.ok) {
        if ('conflict' in result && result.conflict) {
          const server = result.server;
          const merged = loadStoredStudyPlanItems().map((i) => (i.id === server.id ? server : i));
          setStudyPlanItems(merged);
          saveStoredStudyPlanItems(merged);
          showToast('다른 기기에서 이미 완료된 계획이라 로컬 변경을 되돌리지 않았습니다.');
        } else {
          showToast(`${actionLabel} 서버 반영에 실패했습니다: ${result.error}`);
        }
      }
    } catch (e) {
      showToast(`${actionLabel} 서버 반영 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
    }
  };

  const handlePostponePlanItem = (item: StudyPlanItem) => {
    const currentAssigned = item.assignedDate || toSeoulDateString(new Date());
    const nextDate = toSeoulDateString(addDaysToDate(currentAssigned, 1));
    const updated = postponeStudyPlanItem(item.id, nextDate);
    setStudyPlanItems(updated);
    const next = updated.find((i) => i.id === item.id);
    if (next) void syncPlanItemToServer(next, '일정 미루기');
    showToast(`[${item.snapshotTitle}] 일정이 내일(${nextDate})로 미뤄졌습니다. (학습 점수 불변)`);
  };

  const handleSkipPlanItem = (item: StudyPlanItem) => {
    const updated = skipStudyPlanItem(item.id);
    setStudyPlanItems(updated);
    const next = updated.find((i) => i.id === item.id);
    if (next) void syncPlanItemToServer(next, '계획 건너뛰기');
    showToast(`[${item.snapshotTitle}] 이번 계획에서 건너뛰었습니다. (시험 범위는 유지됩니다)`);
  };

  const handleRecalculatePlan = () => {
    const reloadedSettings = loadStoredStudyPlanSettings();
    const reloadedItems = loadStoredStudyPlanItems();
    setStudyPlanSettings(reloadedSettings);
    setStudyPlanItems(reloadedItems);
    showToast('학습 계획이 최신 데이터로 재산출되었습니다.');
  };

  // Stage 10: Personalization handlers
  const handleUpdatePersonalizationSettings = (next: PersonalizationSettings) => {
    setPersonalizationSettings(next);
    saveStoredPersonalizationSettings(next);
    showToast('개인별 복습 추천 설정이 저장되었습니다. 미완료 미래 계획이 재계산되며 완료 기록은 보존됩니다.');
  };

  const handleResetPersonalizationSettings = () => {
    const reset = { ...DEFAULT_PERSONALIZATION_SETTINGS, updatedAt: new Date().toISOString() };
    setPersonalizationSettings(reset);
    saveStoredPersonalizationSettings(reset);
    saveStoredPersonalizationState(
      computeCorrectionState({
        attempts,
        mockExams,
        problems: allProblems,
        subjects,
        concepts: allConcepts,
        settings: reset,
        referenceDate: new Date(),
      })
    );
    showToast('개인별 보정값이 초기화되어 기본 추천으로 복구되었습니다.');
  };

  const handleRecalculateCorrection = () => {
    saveStoredPersonalizationState(
      computeCorrectionState({
        attempts,
        mockExams,
        problems: allProblems,
        subjects,
        concepts: allConcepts,
        settings: personalizationSettings,
        referenceDate: new Date(),
      })
    );
    showToast('현재 기록 기준으로 개인별 보정이 재계산되었습니다.');
  };

  const handleOpenAnalyticsRecord = (subjectId: string, conceptId: string, attemptId?: string) => {
    setIsLearningAnalyticsOpen(false);
    setActiveSubjectId(subjectId);
    saveActiveSubjectId(subjectId);
    setSelectedConceptId(conceptId);

    const concept = allConcepts.find((c) => c.id === conceptId);
    if (attemptId && concept) {
      const matchedEvent = concept.events.find((e) => e.attemptId === attemptId);
      if (matchedEvent) {
        setSelectedEventId(matchedEvent.id);
      } else {
        const lastEvent = concept.events[concept.events.length - 1];
        setSelectedEventId(lastEvent ? lastEvent.id : null);
      }
    } else if (concept && concept.events.length > 0) {
      const lastEvent = concept.events[concept.events.length - 1];
      setSelectedEventId(lastEvent ? lastEvent.id : null);
    }

    handleSelectTab('today');
    setTimeout(() => {
      const el = document.getElementById('archive-record-detail');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  };

  // Postpone 1 day (Schedule shift only: does not boost score or create events)
  const handlePostponeDay = (conceptId?: string) => {
    const targetId = conceptId || selectedConcept?.id;
    if (!targetId) return;

    const { updatedConcepts, postponedConcept } = postponeConceptReview(targetId, 1);
    setAllConcepts(updatedConcepts);

    const targetDate = postponedConcept?.postponedUntil
      ? toSeoulDateString(postponedConcept.postponedUntil)
      : '익일';
    showToast(
      `[${postponedConcept?.title || '개념'}] 권장 복습일정이 +1일 연기되었습니다. (누적 +${postponedConcept?.postponeDays || 1}일, 다음 권장일: ${targetDate})`
    );
  };


  // Reset to initial demo data (also clears IndexedDB material bodies + memory cache)
  const handleResetData = async () => {
    resetToInitialDemoData();
    await clearAllMaterialContent();
    window.location.reload();
  };

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center gap-4 p-6 text-center text-[#191817]">
        <h1 className="text-xl font-bold">학습 데이터를 불러오지 못했습니다</h1>
        <p role="alert" className="max-w-md text-sm text-[#57544e] leading-relaxed">
          저장된 학습 기록 일부를 읽을 수 없습니다. 기록은 삭제되지 않았으니 다시 시도해 주세요.
        </p>
        <p className="text-[11px] font-academic-mono text-[#827d73]">
          영향받은 항목: {loadError.length}개
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-xs bg-[#191817] px-5 py-3 text-sm font-semibold text-white hover:bg-[#33302b] transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center p-6 text-sm font-academic-mono text-[#827d73]">
        Learn my way Academic Suite 초기화 중...
      </div>
    );
  }

  if (cloudStatus === 'loading') {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center p-6 text-sm font-academic-mono text-[#827d73]">
        클라우드 학습 데이터를 불러오는 중...
      </div>
    );
  }

  if (cloudStatus === 'error') {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center gap-4 p-6 text-center text-[#191817]">
        <h1 className="text-xl font-bold">서버 학습 데이터를 불러오지 못했습니다</h1>
        <p role="alert" className="max-w-md text-sm text-[#57544e] leading-relaxed">
          {cloudError ?? '네트워크 또는 서버 오류가 발생했습니다.'}
        </p>
        <p className="text-xs text-[#827d73]">
          서버 읽기 실패를 빈 목록이나 로컬 데이터로 대체하지 않습니다. 다시 시도해 주세요.
        </p>
        <button
          type="button"
          onClick={reloadCloudLibrary}
          className="rounded-xs bg-[#191817] px-5 py-3 text-sm font-semibold text-white hover:bg-[#33302b] transition-colors"
        >
          다시 시도
        </button>
      </div>
    );
  }

  if (!activeSubject) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex flex-col items-center justify-center gap-5 p-6 text-center text-[#191817]">
        <span className="w-3 h-3 bg-[#c52828] inline-block" aria-hidden="true" />
        <h1 className="text-2xl font-bold">첫 과목을 만들어 시작하세요</h1>
        <p className="max-w-md text-sm text-[#57544e] leading-relaxed">
          과목을 만들고 PDF 또는 강의 전사본을 등록하면, 자료를 바탕으로 개념 분석과 문제 생성이
          시작됩니다.
        </p>
        <ol className="text-xs text-[#827d73] space-y-1 text-left">
          <li>1. 과목 생성 (시험 일정 설정)</li>
          <li>2. 학습 자료 등록 (PDF / 전사본)</li>
          <li>3. 개념 검토 후 문제 풀기</li>
        </ol>
        <button
          type="button"
          className="rounded-xs bg-[#191817] px-5 py-3 text-sm font-semibold text-white hover:bg-[#33302b] transition-colors"
          onClick={() => setIsAddSubjectModalOpen(true)}
        >
          과목 만들기
        </button>

        {cloudMigrationState &&
          cloudMigrationState.hasLocalData &&
          !cloudMigrationState.imported &&
          !cloudMigrationState.declined && (
            <div className="max-w-md w-full border border-[#e2ded6] bg-white p-4 rounded-xs text-left space-y-2">
              <p className="text-xs text-[#57544e] leading-relaxed">
                이 브라우저에 저장된 과목·자료가 있습니다. 클라우드로 이전하면 다른 기기에서도
                사용할 수 있습니다. 로컬 원본은 그대로 보존됩니다.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleMigrateCloud}
                  disabled={isMigratingCloud}
                  className="text-xs font-semibold bg-[#c52828] text-white px-3 py-1.5 rounded-xs hover:bg-[#a81f1f] transition-colors disabled:opacity-60"
                >
                  {isMigratingCloud ? '이전 중...' : '클라우드로 이전'}
                </button>
                <button
                  type="button"
                  onClick={handleDeclineCloudMigration}
                  disabled={isMigratingCloud}
                  className="text-xs text-[#57544e] border border-[#c8c2b5] bg-white px-3 py-1.5 rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                >
                  나중에
                </button>
              </div>
            </div>
          )}

        <AddSubjectModal isOpen={isAddSubjectModalOpen} onClose={() => setIsAddSubjectModalOpen(false)} onAddSubject={handleAddSubject} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf8f4] text-[#191817] flex flex-col font-sans selection:bg-[#fef2f2] selection:text-[#c52828]">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-16 right-5 z-50 flex items-center gap-2 px-4 py-2.5 bg-[#191817] text-white border border-[#33302b] rounded-xs shadow-lg text-xs font-academic-mono animate-fade-in">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Logout failure */}
      {logoutError && (
        <div
          role="alert"
          className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] flex items-center gap-3 px-4 py-2.5 bg-[#8a1f1f] text-white border border-[#6f1717] rounded-xs shadow-lg text-xs max-w-[90vw]"
        >
          <span>{logoutError}</span>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="shrink-0 underline font-semibold disabled:opacity-60"
          >
            다시 시도
          </button>
          <button
            type="button"
            onClick={() => setLogoutError(null)}
            className="shrink-0 text-white/80 hover:text-white"
            aria-label="로그아웃 오류 닫기"
          >
            닫기
          </button>
        </div>
      )}

      {/* Top Utility Bar */}
      <TopUtilityBar
        subjects={subjects}
        activeSubject={activeSubject}
        onSelectSubject={handleSelectSubject}
        onOpenAddSubject={() => setIsAddSubjectModalOpen(true)}
        onOpenUpload={() => setIsUploadModalOpen(true)}
        onOpenMaterialsList={() => handleSelectTab('materials')}
        onOpenConceptReview={() => {
          setConceptReviewMaterial(null);
          setIsConceptReviewOpen(true);
        }}
        draftCount={activeSubjectDrafts.length}
        onOpenProblemGenerator={() => setIsProblemGeneratorOpen(true)}
        onOpenProblemReview={() => handleSelectTab('problems')}
        problemDraftCount={activeSubjectProblemDrafts.length}
        problemReportedCount={activeSubjectReportedCount}
        onOpenProblemSession={() => {
          if (!activeSessionProblem && availableSubjectProblems.length > 0) {
            openProblemSessionScreen(availableSubjectProblems[0].id);
          } else if (activeSessionProblem) {
            handleSelectTab('session');
          } else {
            showToast('풀이 가능한 승인된 문제가 없습니다. 먼저 문제를 출제·승인해 주세요.');
          }
        }}
        onOpenMockExam={() => {
          openMockExamScreen();
        }}
        onOpenStudyPlan={() => setIsStudyPlanOpen(true)}
        onOpenLearningAnalytics={() => handleSelectTab('history')}
        onOpenSettings={() => handleSelectTab('settings')}
        onScrollToTodayReview={() => handleSelectTab('today')}
        activeTab={activeTab}
        onSelectTab={handleSelectTab}
        userEmail={currentUser.email}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
      />

      {aiConnectionMissing && (
        <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2.5 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
            <div className="text-xs text-[#57544e]">
              <span className="font-bold text-[#191817]">AI 기능을 사용하려면 내 API 연결이 필요합니다.</span>{' '}
              학교 BAZE API 키를 등록하면 AI 호출 크레딧이 키를 발급한 계정에서 차감됩니다.
            </div>
            <button
              type="button"
              onClick={() => handleSelectTab('settings')}
              className="text-xs font-semibold bg-[#191817] text-white px-3 py-1.5 rounded-xs hover:bg-[#33302b] transition-colors shrink-0"
            >
              내 API 연결
            </button>
          </div>
        </div>
      )}

      {/* URL Notice Banner */}
      {urlNotice && (
        <div role="alert" className="w-full bg-amber-50 border-b border-amber-300">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <p className="font-bold">{urlNotice.message}</p>
                <p className="text-[11px] text-amber-800">
                  링크 주소를 다시 확인하거나 아래 버튼을 통해 정상 화면으로 이동할 수 있습니다.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setUrlNotice(null);
                  handleSelectTab('today');
                }}
                className="px-3 py-1.5 bg-[#191817] hover:bg-[#33302b] text-white font-bold rounded-xs transition-colors"
              >
                오늘 학습으로 이동
              </button>
              {urlNotice.entity?.kind !== 'subject' && (
                <button
                  type="button"
                  onClick={() => {
                    const fallbackTab = urlNotice.entity?.kind === 'material'
                      ? 'materials'
                      : urlNotice.entity?.kind === 'problem' || urlNotice.entity?.kind === 'exam'
                      ? 'problems'
                      : 'history';
                    setUrlNotice(null);
                    handleSelectTab(fallbackTab);
                  }}
                  className="px-3 py-1.5 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] rounded-xs transition-colors"
                >
                  목록으로 이동
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Active Session / Exam Resume Banners when navigating to another tab */}
      {activeTab !== 'session' && isProblemSessionOpen && (pinnedSessionProblem || activeSessionProblem) && (
        <div className="w-full bg-amber-50/90 border-b border-amber-300">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between text-xs text-amber-900">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              <span>
                진행 중인 문제 풀이가 있습니다: <strong>{(pinnedSessionProblem || activeSessionProblem)!.title}</strong>
                {pinnedSessionSubject && pinnedSessionProblem && pinnedSessionSubject.id !== activeSubject.id && (
                  <> · 소속 과목: <strong>{pinnedSessionSubject.name}</strong></>
                )}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                // Return path also restores the session's own subject.
                if (pinnedSessionProblem && pinnedSessionProblem.subjectId !== activeSubject.id) {
                  handleSelectSubject(pinnedSessionProblem.subjectId);
                }
                handleSelectTab('session', { problemId: pinnedSessionProblem?.id });
              }}
              className="px-2.5 py-1 bg-amber-800 hover:bg-amber-900 text-white font-bold rounded-xs transition-colors"
            >
              문제 풀이 화면으로 돌아가기
            </button>
          </div>
        </div>
      )}

      {activeTab !== 'exam' && isMockExamModalOpen && (
        <div className="w-full bg-purple-50/90 border-b border-purple-300">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-2 flex items-center justify-between text-xs text-purple-900">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              <span>
                {activeMockSession?.status === 'in_progress'
                  ? '진행 중인 모의시험이 있습니다. (제한 시간 작동 중)'
                  : activeMockSession?.status === 'submitted'
                  ? '제출된 모의시험이 있습니다. (채점 대기)'
                  : activeMockSession?.status === 'graded'
                  ? '채점이 완료된 모의시험이 있습니다.'
                  : '모의시험 화면이 열려 있습니다.'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleSelectTab('exam')}
              className="px-2.5 py-1 bg-purple-800 hover:bg-purple-900 text-white font-bold rounded-xs transition-colors"
            >
              모의시험 화면으로 돌아가기
            </button>
          </div>
        </div>
      )}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {activeTab === 'today' && (
          <TodayWorkspace
            activeSubject={activeSubject}
            onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
            onOpenScopeModal={() => setIsScopeModalOpen(true)}
            primaryCta={primaryCta}
            onPrimaryAction={primaryCta ? handleStartTodayPrimary : undefined}
            todayDigest={todayDigest}
            todayDayLabel={todayDayLabel}
            hasActiveSession={Boolean(activeMockSession)}
            onStartPlanItem={handleStartPlanItem}
            onResumeMock={handleResumeMockExam}
            onOpenAllStudyPlan={() => setIsStudyPlanOpen(true)}
            subjectConcepts={subjectConcepts}
            selectedConcept={selectedConcept}
            comparedConcepts={comparedConcepts}
            isComparisonMode={isComparisonMode}
            onToggleComparisonMode={() => {
              const nextMode = !isComparisonMode;
              setIsComparisonMode(nextMode);
              if (nextMode && comparedConceptIds.length === 0 && selectedConcept) {
                setComparedConceptIds([selectedConcept.id]);
              }
            }}
            selectedEventId={selectedEventId}
            onSelectEvent={(evId) => setSelectedEventId(evId)}
            settings={settings}
            examDDay={examDDay}
            sortMode={sortMode}
            onChangeSortMode={setSortMode}
            selectedConceptId={selectedConceptId}
            onSelectConcept={handleSelectConcept}
            comparedConceptIds={comparedConceptIds}
            onToggleCompareConcept={handleToggleCompareConcept}
            subjectProblems={subjectProblems}
            selectedProblemType={selectedProblemType}
            onSelectProblemType={setSelectedProblemType}
            onStartSession={(problemId) => {
              openProblemSessionScreen(problemId);
            }}
            onPostponeDay={handlePostponeDay}
            onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
            onOpenProblemGenerator={(conceptId) => {
              if (conceptId) {
                setSelectedConceptId(conceptId);
              }
              setIsProblemGeneratorOpen(true);
            }}
            onOpenProblemReview={() => handleSelectTab('problems')}
            activeSubjectProblemDraftsCount={activeSubjectProblemDrafts.length}
            selectedConceptRecommendation={selectedConceptRecommendation}
            selectedEvent={selectedEvent}
            attempts={attempts}
            allProblems={allProblems}
            onReportProblem={handleReportProblem}
            onOpenLogicStrengthen={handleOpenLogicStrengthen}
            onOpenUpload={() => setIsUploadModalOpen(true)}
          />
        )}

        {activeTab === 'materials' && (
          <MaterialsWorkspace
            activeSubject={activeSubject}
            materials={materials}
            drafts={conceptDrafts}
            onOpenUpload={() => setIsUploadModalOpen(true)}
            onSelectMaterial={(mat) => {
              setEditingMaterial(mat);
              setIsMaterialEditorOpen(true);
              handleSelectTab('materials', { materialId: mat.id });
            }}
            hasOriginal={(materialId) => Boolean(cloudOriginalPaths[materialId])}
            onOpenOriginal={handleOpenOriginal}
            onOpenConceptReview={(mat) => {
              setConceptReviewMaterial(mat || null);
              setIsConceptReviewOpen(true);
            }}
            onTriggerAnalysis={handleTriggerAiAnalysis}
            isAnalyzing={isAiAnalyzing}
            onReconnectFile={async (material, kind, file) =>
              kind === 'original'
                ? handleReconnectOriginal(material, file)
                : handleReconnectBody(material, file)
            }
            onDeleteMaterial={async (materialId) => {
              const isLocalOnly = isLocalOnlyMaterial(materialId);
              if (!isLocalOnly) {
                const result = await deleteMaterial(materialId);
                if (!result.ok) {
                  showToast(`자료 삭제 실패: ${result.error}`);
                  return;
                }
              }
              markMaterialDeleted(materialId);
              clearLocalOnlyMaterialMarker(materialId);
              const updated = materials.filter((m) => m.id !== materialId);
              setMaterials(updated);
              saveStoredMaterials(updated);
              removeStoredMaterialBodyHash(materialId);
              const bodyCleanup = await deleteMaterialContent(materialId);
              const originalCleanup = await deleteMaterialOriginal(materialId);
              const localCleanupOk = bodyCleanup.deleted && originalCleanup.deleted;
              showToast(
                localCleanupOk
                  ? '자료와 이 기기에 저장된 본문·원본이 삭제되었습니다.'
                  : `자료 메타데이터는 삭제되었으나 로컬 파일 정리에 일부 실패했습니다. (${bodyCleanup.error || originalCleanup.error || '다시 시도 가능'})`
              );
            }}
          />
        )}

        {activeTab === 'problems' && (
          <ProblemsWorkspace
            activeSubject={activeSubject}
            problems={allProblems}
            drafts={problemDrafts}
            materials={materials}
            concepts={subjectConcepts}
            onOpenGenerator={() => setIsProblemGeneratorOpen(true)}
            onStartProblemSession={(problemId) => {
              openProblemSessionScreen(problemId || (availableSubjectProblems[0]?.id));
            }}
            onStartMockExam={() => {
              openMockExamScreen();
            }}
            hasActiveMockSession={Boolean(activeMockSession)}
            onResumeMockExam={handleResumeMockExam}
            onUpdateDraft={handleUpdateProblemDraft}
            onApproveDraft={handleApproveProblemDraft}
            onBatchApproveDrafts={handleBatchApproveProblemDrafts}
            onDeleteDraft={handleDeleteProblemDraft}
            onUpdateProblemQualityStatus={handleUpdateProblemQualityStatus}
            onDismissReport={handleDismissProblemReport}
            onReviseProblem={handleReviseProblem}
            onReapproveProblem={handleReapproveProblem}
            onSuspendProblem={handleSuspendProblem}
          />
        )}

        {activeTab === 'history' && (
          <HistoryWorkspace
            activeSubject={activeSubject}
            subjects={subjects}
            concepts={allConcepts}
            problems={allProblems}
            attempts={attempts}
            mockExams={mockExams}
            personalizationSettings={personalizationSettings}
            correctionState={effectiveCorrectionState}
            onUpdatePersonalizationSettings={handleUpdatePersonalizationSettings}
            onResetPersonalizationSettings={handleResetPersonalizationSettings}
            onRecalculateCorrection={handleRecalculateCorrection}
            onOpenLogicStrengthen={handleOpenLogicStrengthen}
            onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
            onReportProblem={handleReportProblem}
            initialSelectedAttemptId={selectedAttemptId}
            onSelectAttempt={(attId) => {
              setSelectedAttemptId(attId);
              handleSelectTab('history', { attemptId: attId || undefined });
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsWorkspace
            settings={settings}
            onSaveSettings={(newSettings) => {
              setSettings(newSettings);
              saveStoredSettings(newSettings);
              showToast('복습 감쇠 모델 설정이 저장되었습니다.');
            }}
            onResetData={handleResetData}
            materials={materials}
            subjects={subjects}
            onRestoreMaterials={handleRestoreMaterials}
            migrationBlocks={migrationBlocks}
            currentUserEmail={currentUser.email}
            onLogout={handleLogout}
            isLoggingOut={isLoggingOut}
          />
        )}

        {/* Dedicated in-layout screen: Problem Session */}
        <div className={activeTab === 'session' ? 'block' : 'hidden'}>
          {isProblemSessionOpen && sessionSubjectMismatch && pinnedSessionProblem && pinnedSessionSubject ? (
            <div className="bg-white border border-[#c8c2b5] rounded-xs p-8 text-center max-w-xl mx-auto my-8">
              <p className="text-sm font-semibold text-[#191817] mb-2">
                진행 중인 풀이는 다른 과목에 속해 있습니다.
              </p>
              <p className="text-xs text-[#57544e] mb-4">
                소속 과목: <strong>{pinnedSessionSubject.name}</strong> · 문제:{' '}
                <strong>{pinnedSessionProblem.title}</strong>
                <br />
                현재 선택된 과목 [{activeSubject.name}]의 풀이로 표시하지 않습니다. 원래 과목으로 돌아가 이어서 풀 수 있습니다.
              </p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    handleSelectSubject(pinnedSessionProblem.subjectId);
                    handleSelectTab('session', { problemId: pinnedSessionProblem.id });
                  }}
                  className="px-3.5 py-1.5 bg-[#191817] text-white text-xs font-bold rounded-xs transition-colors"
                >
                  {pinnedSessionSubject.name} 과목으로 돌아가 계속 풀기
                </button>
                <button
                  type="button"
                  onClick={closeProblemSession}
                  className="px-3.5 py-1.5 border border-[#ded6c8] bg-white text-[#57544e] text-xs font-bold rounded-xs transition-colors"
                >
                  풀이 닫기
                </button>
              </div>
            </div>
          ) : isProblemSessionOpen && sessionConcept && activeSessionProblem ? (
            <ProblemSessionModal
              variant="page"
              key={`${activeSubject.id}-${activeSessionProblem.id}-${activeSessionProblem.version ?? 1}`}
              isOpen={isProblemSessionOpen}
              onClose={closeProblemSession}
              subject={activeSubject}
              concept={sessionConcept}
              problem={activeSessionProblem}
              userId={currentUser.id}
              onSubmitAttempt={handleSubmitAttempt}
              rechallengeReservationId={activeRechallengeReservationId || undefined}
              planItemId={activePlanItemIdForSession || undefined}
              onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
              onReportProblem={handleReportProblem}
            />
          ) : activeTab === 'session' ? (
            <div className="bg-white border border-[#c8c2b5] rounded-xs p-8 text-center max-w-xl mx-auto my-8">
              <p className="text-sm font-semibold text-[#191817] mb-2">진행 중인 문제 풀이 세션이 없습니다.</p>
              <p className="text-xs text-[#57544e] mb-4">문제은행에서 풀이할 문제를 선택하거나 오늘 학습에서 복습을 시작해 주세요.</p>
              <button
                type="button"
                onClick={() => handleSelectTab('problems')}
                className="px-3.5 py-1.5 bg-[#191817] text-white text-xs font-bold rounded-xs transition-colors"
              >
                문제은행으로 이동
              </button>
            </div>
          ) : null}
        </div>

        {/* Dedicated in-layout screen: Mock Exam */}
        <div className={activeTab === 'exam' ? 'block' : 'hidden'}>
          {isMockExamModalOpen ? (
            <MockExamModal
              variant="page"
              key={`${activeSubject.id}-${examIdFromUrl ?? 'active'}`}
              isOpen={isMockExamModalOpen}
              onClose={() => {
                setIsMockExamModalOpen(false);
                setMockExamInitialConfig(null);
                setExamIdFromUrl(null);
                handleSelectTab('problems');
              }}
              subject={activeSubject}
              concepts={subjectConcepts}
              problems={availableSubjectProblems}
              userId={currentUser.id}
              initialConfig={mockExamInitialConfig}
              initialExamId={examIdFromUrl}
              deferExpiredSubmit={Boolean(examIdFromUrl)}
              onExamRecorded={() => {
                setAllConcepts(loadStoredConcepts());
                setAttempts(loadStoredAttempts());
                setMockExams(loadMockExams());
                setIsMockExamModalOpen(false);
                setMockExamInitialConfig(null);
                setExamIdFromUrl(null);
                handleSelectTab('history');
                showToast('모의시험 답안과 평가가 학습 이력에 저장되었습니다.');
              }}
            />
          ) : activeTab === 'exam' ? (
            <div className="bg-white border border-[#c8c2b5] rounded-xs p-8 text-center max-w-xl mx-auto my-8">
              <p className="text-sm font-semibold text-[#191817] mb-2">진행 중인 모의시험이 없습니다.</p>
              <p className="text-xs text-[#57544e] mb-4">새 모의시험을 시작하거나 문제은행으로 이동해 주세요.</p>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsMockExamModalOpen(true)}
                  className="px-3.5 py-1.5 bg-[#c52828] text-white text-xs font-bold rounded-xs transition-colors"
                >
                  새 모의시험 시작
                </button>
                <button
                  type="button"
                  onClick={() => handleSelectTab('problems')}
                  className="px-3.5 py-1.5 bg-[#191817] text-white text-xs font-bold rounded-xs transition-colors"
                >
                  문제은행으로 이동
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </main>

      {/* Clean Academic Footer (Fake company / fake patent info removed as requested) */}
      <footer className="w-full border-t border-[#e2ded6] bg-[#ffffff] mt-8 py-5 text-xs text-[#827d73]">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-3 font-academic-mono text-[11px]">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-[#c52828] inline-block" />
            <span className="font-bold text-[#191817]">Learn my way ACADEMIC SYSTEM</span>
            <span className="text-[#c8c2b5]">|</span>
            <span>수리통계 및 알고리즘 서술·증명 복습 플랫폼 (데모)</span>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[#57544e]">
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="hover:text-[#191817] underline decoration-dotted"
            >
              설정
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}

      {/* 2. Exam Schedule Modal */}
      <ExamScheduleModal
        isOpen={isScheduleModalOpen}
        onClose={() => setIsScheduleModalOpen(false)}
        subject={activeSubject}
        onUpdateSubject={handleUpdateSubject}
      />

      {/* 3. Scope Management Modal */}
      <ScopeManageModal
        isOpen={isScopeModalOpen}
        onClose={() => setIsScopeModalOpen(false)}
        subject={activeSubject}
        onUpdateSubject={handleUpdateSubject}
      />

      {/* 4. Material Upload Modal */}
      <MaterialUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        subjects={subjects}
        activeSubject={activeSubject}
        onAddMaterial={handleAddMaterial}
        onOpenEditor={(newMat) => {
          setEditingMaterial(newMat);
          setIsMaterialEditorOpen(true);
        }}
      />

      {/* 4.1 Materials Repository List Modal */}
      <MaterialsListModal
        isOpen={isMaterialsListOpen}
        onClose={() => setIsMaterialsListOpen(false)}
        activeSubject={activeSubject}
        materials={materials}
        drafts={conceptDrafts}
        onOpenUpload={() => {
          setIsMaterialsListOpen(false);
          setIsUploadModalOpen(true);
        }}
        onSelectMaterial={(mat) => {
          setEditingMaterial(mat);
          setIsMaterialEditorOpen(true);
        }}
        hasOriginal={(materialId) => Boolean(cloudOriginalPaths[materialId])}
        onOpenOriginal={handleOpenOriginal}
        onReconnectFile={async (material, kind, file) =>
          kind === 'original'
            ? handleReconnectOriginal(material, file)
            : handleReconnectBody(material, file)
        }
        onDeleteMaterial={async (materialId) => {
          const isLocalOnly = isLocalOnlyMaterial(materialId);
          // Server-known materials must be deleted on the server first; never hide server delete failures.
          // Local-only materials (e.g. restored from backup) do not require server success.
          if (!isLocalOnly) {
            const result = await deleteMaterial(materialId);
            if (!result.ok) {
              showToast(`자료 삭제 실패: ${result.error}`);
              return;
            }
          }
          // Ledger the explicit deletion BEFORE any local save, so no later
          // wholesale list save (or stale snapshot) can resurrect this material.
          markMaterialDeleted(materialId);
          clearLocalOnlyMaterialMarker(materialId);
          const updated = materials.filter((m) => m.id !== materialId);
          setMaterials(updated);
          saveStoredMaterials(updated);
          removeStoredMaterialBodyHash(materialId);
          // Local body + original removal is separate from the metadata delete.
          const bodyCleanup = await deleteMaterialContent(materialId);
          const originalCleanup = await deleteMaterialOriginal(materialId);
          const localCleanupOk = bodyCleanup.deleted && originalCleanup.deleted;
          showToast(
            localCleanupOk
              ? '자료와 이 기기에 저장된 본문·원본이 삭제되었습니다.'
              : `자료 메타데이터는 삭제되었으나 로컬 파일 정리에 일부 실패했습니다. (${bodyCleanup.error || originalCleanup.error || '다시 시도 가능'})`
          );
        }}
        onOpenConceptReview={(mat) => {
          setIsMaterialsListOpen(false);
          setConceptReviewMaterial(mat || null);
          setIsConceptReviewOpen(true);
        }}
        onTriggerAnalysis={handleTriggerAiAnalysis}
        isAnalyzing={isAiAnalyzing}
      />

      {/* 4.2 Material Side-by-Side Comparison Editor Modal */}
      {isMaterialEditorOpen && editingMaterial && (
      <MaterialEditorModal
        key={editingMaterial.id}
        isOpen
        onClose={() => {
          setIsMaterialEditorOpen(false);
          setEditingMaterial(null);
        }}
        material={editingMaterial}
        subject={activeSubject}
        draftCount={editingMaterial ? conceptDrafts.filter((d) => d.materialId === editingMaterial.id).length : 0}
        onSave={async (updatedMat, updatedContent): Promise<MaterialServerSaveResult> => {
          const scopeAtStart = getStorageScopeId();
          const contentForSave = {
            markdown: updatedContent.markdown,
            rawText: updatedMat.rawText,
            pages: updatedContent.pages,
          };
          const contentHash = materialContentHash(contentForSave);

          if (isLocalOnlyMaterial(updatedMat.id)) {
            const effects = await applyMaterialEditSideEffects(updatedMat, scopeAtStart);
            // Local-only material: the body sync state never claims the server.
            recordMaterialSyncState(updatedMat.id, {
              localBodyHash: contentHash,
              status: 'not_required',
            });
            showMaterialEditToast(updatedMat.title, effects, 'local');
            return { status: 'not_required' };
          }

          const syncBody = materialPolicyOf(updatedMat).syncBody;
          const previousSave = getMaterialServerSaveRecord(updatedMat.id);
          const retryingSameContent = Boolean(previousSave && previousSave.contentHash === contentHash);

          // Response-loss recovery: if a previous save of THIS exact content is
          // on record, ask the SERVER what it stored before uploading again.
          if (retryingSameContent) {
            const probe = await getMaterialServerBodyHash(updatedMat.id);
            const verdict = evaluateMaterialServerRetry(previousSave, contentHash, {
              ok: probe.ok,
              hasBody: probe.ok ? probe.data.hasBody : undefined,
              hash: probe.ok ? probe.data.hash : null,
              version: probe.ok ? probe.data.version : undefined,
            });
            if (verdict === 'already_saved') {
              // The server already holds this exact body: recover WITHOUT a new
              // upload/version bump, but run the SAME post-processing as a save.
              recordMaterialServerSave(updatedMat.id, {
                contentHash,
                baseHash: previousSave?.baseHash ?? null,
                baseVersion: previousSave?.baseVersion,
                syncBody,
                jobId: previousSave?.jobId ?? null,
              });
              recordMaterialSyncState(
                updatedMat.id,
                syncBody
                  ? { serverBodyHash: contentHash, serverHasBody: true, status: 'confirmed' }
                  : { status: 'not_required' }
              );
              const effects = await applyMaterialEditSideEffects(updatedMat, scopeAtStart);
              showMaterialEditToast(updatedMat.title, effects, 'recovered');
              return { status: 'already_saved' };
            }
            if (verdict === 'conflict') {
              showToast('서버에 이후 변경된 본문이 있어 덮어쓰지 않았습니다. 새로고침 후 다시 확인해 주세요.');
              return { status: 'failed', error: '서버에 이후 변경된 본문이 있어 덮어쓰지 않았습니다.' };
            }
            if (verdict === 'unknown') {
              showToast('이전 서버 저장 여부를 확인하지 못했습니다. 네트워크를 확인한 뒤 다시 시도해 주세요.');
              return { status: 'failed', error: '이전 서버 저장 여부를 확인하지 못했습니다. 다시 시도해 주세요.' };
            }
            // 'retry_same_job' | 'no_record': the earlier request did not land —
            // a (re)write may proceed below, reusing the same job id when known.
          }

          // Capture the server state BEFORE the attempt so a lost response can be
          // recognized as "server unchanged" (baseHash/baseVersion) on retry.
          const probeBefore = await getMaterialServerBodyHash(updatedMat.id);
          const baseHash = probeBefore.ok ? probeBefore.data.hash : previousSave?.baseHash ?? null;
          const baseVersion = probeBefore.ok ? probeBefore.data.version : previousSave?.baseVersion ?? 0;
          const reuseJobId = retryingSameContent ? previousSave?.jobId ?? undefined : undefined;
          recordMaterialServerSave(updatedMat.id, {
            contentHash,
            baseHash,
            baseVersion,
            syncBody,
            jobId: reuseJobId ?? null,
          });

          const writeResult = await writeMaterial({
            material: updatedMat,
            content: contentForSave,
            policy: materialPolicyOf(updatedMat),
            jobId: reuseJobId,
          });
          if (!writeResult.ok) {
            // The request may have actually reached the server (response loss).
            // Keep the retry record; a later retry of the same content probes
            // the server instead of uploading again.
            recordMaterialSyncState(updatedMat.id, { status: 'failed' });
            showToast(`자료 수정 저장 실패: ${writeResult.error}`);
            return { status: 'failed', error: writeResult.error };
          }
          // Remember the job id the write actually used so a retry reuses it.
          recordMaterialServerSave(updatedMat.id, {
            contentHash,
            baseHash,
            baseVersion,
            syncBody,
            jobId: writeResult.data.jobId ?? reuseJobId ?? null,
          });
          recordMaterialSyncState(
            updatedMat.id,
            syncBody
              ? { serverBodyHash: contentHash, serverHasBody: true, status: 'confirmed' }
              : { status: 'not_required' }
          );

          const effects = await applyMaterialEditSideEffects(updatedMat, scopeAtStart);
          showMaterialEditToast(
            updatedMat.title,
            effects,
            writeResult.data?.fallbackUsed ? 'fallback' : 'saved'
          );
          return { status: 'saved', fallbackUsed: writeResult.data?.fallbackUsed };
        }}
        onOpenConceptReview={(mat) => {
          setConceptReviewMaterial(mat || null);
          setIsConceptReviewOpen(true);
        }}
        onTriggerAnalysis={handleTriggerAiAnalysis}
        isAnalyzing={isAiAnalyzing}
      />
      )}

      {/* 4.3 AI Concept Extraction & Review Modal (Stage 2) */}
      <ConceptReviewModal
        isOpen={isConceptReviewOpen}
        onClose={() => {
          setIsConceptReviewOpen(false);
          setConceptReviewMaterial(null);
        }}
        activeSubject={activeSubject}
        material={conceptReviewMaterial}
        drafts={conceptDrafts}
        onUpdateDrafts={(updatedDrafts) => {
          setConceptDrafts(updatedDrafts);
        }}
        onConceptsUpdated={(updatedConcepts) => {
          setAllConcepts(updatedConcepts);
        }}
        onOpenMaterialEditor={(mat) => {
          setIsConceptReviewOpen(false);
          setEditingMaterial(mat);
          setIsMaterialEditorOpen(true);
        }}
        onTriggerAnalysis={handleTriggerAiAnalysis}
        isAnalyzing={isAiAnalyzing}
        onApproveConceptDraft={async (draft) => {
          const result = await approveConceptViaServer(draft, allConcepts, conceptDrafts);
          if (result.status === 'ok') {
            setAllConcepts(result.entities);
            saveStoredConcepts(result.entities);
            setConceptDrafts(result.drafts);
            saveStoredConceptDrafts(result.drafts);
            showToast(`개념 [${draft.title}]이(가) 서버에 승인되었습니다.`);
            return true;
          }
          showToast(
            result.status === 'partial'
              ? result.error ?? '서버 승인은 완료됐지만 화면 갱신에 실패했습니다. 새로고침해 주세요.'
              : `개념 승인 실패: ${result.error ?? '다시 시도해 주세요.'}`
          );
          return false;
        }}
        onBatchApproveConceptDrafts={async (pending) => {
          let concepts = allConcepts;
          let drafts = conceptDrafts;
          let approvedCount = 0;
          let failed = 0;
          let partial = 0;
          for (const draft of pending) {
            const result = await approveConceptViaServer(draft, concepts, drafts);
            if (result.status === 'ok') {
              concepts = result.entities;
              drafts = result.drafts;
              approvedCount += 1;
            } else if (result.status === 'partial') {
              partial += 1;
            } else {
              failed += 1;
            }
          }
          setAllConcepts(concepts);
          saveStoredConcepts(concepts);
          setConceptDrafts(drafts);
          saveStoredConceptDrafts(drafts);
          showToast(
            failed > 0 || partial > 0
              ? `${approvedCount}건 승인 완료, 실패 ${failed}건·부분 ${partial}건. 해당 항목을 새로고침 후 확인해 주세요.`
              : `선택한 개념 ${approvedCount}건이 서버에 승인 완료되었습니다.`
          );
          return true;
        }}
        onUpdateConceptDraft={async (draft) => {
          if (draft.contentVersion === undefined) return false;
          try {
            const supabase = createBrowserSupabaseClient();
            const result = await updateConceptDraftCloud(supabase, draft, draft.contentVersion);
            if (!result.ok) {
              showToast(`개념 초안 수정 저장 실패: ${result.error}`);
              return false;
            }
            const next = conceptDrafts.map((d) => (d.id === result.data.id ? result.data : d));
            setConceptDrafts(next);
            saveStoredConceptDrafts(next);
            return true;
          } catch (e) {
            showToast(`개념 초안 수정 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
            return false;
          }
        }}
        onDeleteConceptDraft={async (draftId) => {
          const draft = conceptDrafts.find((d) => d.id === draftId);
          if (draft?.contentVersion !== undefined) {
            try {
              const supabase = createBrowserSupabaseClient();
              const result = await deleteConceptDraftCloud(supabase, draftId);
              if (!result.ok) {
                showToast(`개념 초안 삭제 실패: ${result.error}`);
                return false;
              }
            } catch (e) {
              showToast(`개념 초안 삭제 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
              return false;
            }
          }
          const next = conceptDrafts.filter((d) => d.id !== draftId);
          setConceptDrafts(next);
          saveStoredConceptDrafts(next);
          return true;
        }}
      />

      {/* 5. PDF Reference Excerpt Reader Modal */}
      {pdfViewerSourceRef && (
      <PdfViewerModal
        key={pdfViewerSourceRef}
        isOpen
        onClose={() => setPdfViewerSourceRef(null)}
        sourceRef={pdfViewerSourceRef}
        conceptTitle={selectedConcept?.title}
        material={
          materials.find(
            (m) =>
              m.subjectId === activeSubject.id &&
              (m.sourceRefs.includes(pdfViewerSourceRef || '') ||
                m.title.includes(pdfViewerSourceRef || ''))
          ) ||
          materials.find((m) => m.subjectId === activeSubject.id) ||
          null
        }
        onOpenEditor={(mat) => {
          setPdfViewerSourceRef(null);
          setEditingMaterial(mat);
          setIsMaterialEditorOpen(true);
        }}
      />
      )}

      {/* 6. Settings Modal */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        settings={settings}
        onSaveSettings={(newSettings) => {
          setSettings(newSettings);
          saveStoredSettings(newSettings);
          showToast('복습 감쇠 모델 설정이 저장되었습니다.');
        }}
        onResetData={handleResetData}
        materials={materials}
        subjects={subjects}
        onRestoreMaterials={handleRestoreMaterials}
        migrationBlocks={migrationBlocks}
      />

      {/* 7. Mock Exam (Handled as dedicated screen above) */}

      {/* 8. Add Subject Modal (Stage 0) */}
      <AddSubjectModal
        isOpen={isAddSubjectModalOpen}
        onClose={() => setIsAddSubjectModalOpen(false)}
        onAddSubject={handleAddSubject}
      />

      {/* 9. AI Problem Generator Modal (Stage 3) */}
      {isProblemGeneratorOpen && <ProblemGeneratorModal
        key={`${activeSubject.id}-${selectedConceptId}`}
        isOpen={isProblemGeneratorOpen}
        onClose={() => setIsProblemGeneratorOpen(false)}
        activeSubject={activeSubject}
        concepts={subjectConcepts}
        materials={materials.filter((m) => m.subjectId === activeSubject.id)}
        selectedConceptId={selectedConceptId}
        onGenerateSuccess={handleProblemGenerateSuccess}
      />}

      {/* 10. AI Problem Review & Approval Modal (Stage 3 & 6) */}
      <ProblemReviewModal
        isOpen={isProblemReviewOpen}
        onClose={() => setIsProblemReviewOpen(false)}
        activeSubject={activeSubject}
        drafts={problemDrafts}
        problems={allProblems}
        materials={materials}
        onUpdateDraft={handleUpdateProblemDraft}
        onApproveDraft={handleApproveProblemDraft}
        onBatchApproveDrafts={handleBatchApproveProblemDrafts}
        onDeleteDraft={handleDeleteProblemDraft}
        onStartPracticeSession={handleStartPracticeFromDraft}
        onOpenGenerator={() => {
          setIsProblemReviewOpen(false);
          setIsProblemGeneratorOpen(true);
        }}
        onUpdateProblemQualityStatus={handleUpdateProblemQualityStatus}
        onDismissReport={handleDismissProblemReport}
        onReviseProblem={handleReviseProblem}
        onReapproveProblem={handleReapproveProblem}
        onSuspendProblem={handleSuspendProblem}
      />

      {/* 11. Study Plan Modal (Stage 9) */}
      {isStudyPlanOpen && (
      <StudyPlanModal
        key={activeSubject.id}
        isOpen
        onClose={() => setIsStudyPlanOpen(false)}
        subjects={subjects}
        activeSubject={activeSubject}
        concepts={allConcepts}
        studyPlanSummary={studyPlanSummary}
        settings={studyPlanSettings}
        onUpdateSettings={(newSettings) => {
          setStudyPlanSettings(newSettings);
          saveStoredStudyPlanSettings(newSettings);
          showToast('학습 계획 설정이 저장되었습니다.');
          if (isSupabaseConfigured()) {
            void (async () => {
              try {
                const supabase = createBrowserSupabaseClient();
                const result = await upsertStudyPlanSettings(supabase, newSettings);
                if (!result.ok) showToast(`학습 계획 설정 서버 저장 실패: ${result.error}`);
              } catch (e) {
                showToast(`학습 계획 설정 서버 저장 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
              }
            })();
          }
        }}
        onStartItem={handleStartPlanItem}
        onPostponeItem={handlePostponePlanItem}
        onSkipItem={handleSkipPlanItem}
        onRecalculatePlan={handleRecalculatePlan}
      />
      )}

      {/* 12. Learning Analytics & Personalization Modal (Stage 10) */}
      <LearningAnalyticsModal
        isOpen={isLearningAnalyticsOpen}
        onClose={() => setIsLearningAnalyticsOpen(false)}
        subjects={subjects}
        concepts={allConcepts}
        problems={allProblems}
        attempts={attempts}
        mockExams={mockExams}
        activeSubjectId={activeSubject.id}
        personalizationSettings={personalizationSettings}
        correctionState={effectiveCorrectionState}
        onUpdatePersonalizationSettings={handleUpdatePersonalizationSettings}
        onResetPersonalizationSettings={handleResetPersonalizationSettings}
        onRecalculateCorrection={handleRecalculateCorrection}
        onOpenRecord={handleOpenAnalyticsRecord}
      />

      {/* 13. Answer-Logic Strengthening Session (Stage 13) */}
      {logicTarget && (
        <LogicStrengthenModal
          key={logicTarget.attempt.id}
          isOpen
          onClose={() => setLogicTarget(null)}
          subject={subjects.find((s) => s.id === logicTarget.attempt.subjectId) || activeSubject}
          concept={logicTarget.concept}
          problem={logicTarget.problem}
          sourceAttempt={logicTarget.attempt}
          recommendationDate={logicRecommendationDate || undefined}
          reservations={rechallengeReservations}
          approvedTransferProblems={allProblems.filter(
            (p) =>
              p.isTransfer === true &&
              p.sourceProblemId === logicTarget.problem.id &&
              p.subjectId === logicTarget.attempt.subjectId &&
              isProblemAvailableForPractice(p)
          )}
          onRecordAssistedAttempt={handleRecordAssistedAttempt}
          onReserveRechallenge={handleReserveRechallenge}
          onUpdateReservation={handleUpdateReservation}
          onCancelReservation={handleCancelReservation}
          onSaveTransferDraft={handleSaveTransferDraft}
          onStartTransferProblem={handleStartTransferProblem}
        />
      )}
    </div>
  );
}

