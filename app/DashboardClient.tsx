'use client';

import React, { useState, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import {
  Subject,
  Material,
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
import {
  loadStoredSubjects,
  saveStoredSubjects,
  loadActiveSubjectId,
  saveActiveSubjectId,
  loadStoredMaterials,
  saveStoredMaterials,
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
  submitAttempt as submitAttemptCloud,
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
import { TopUtilityBar } from '../components/TopUtilityBar';
import { ExamRecordCard } from '../components/ExamRecordCard';
import { StatusStrip } from '../components/StatusStrip';
import { ConceptRail, SortMode } from '../components/ConceptRail';
import { ForgettingCurveChart } from '../components/ForgettingCurveChart';
import { ArchiveRecordDetail } from '../components/ArchiveRecordDetail';
import { TodayReviewPanel } from '../components/TodayReviewPanel';
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
import {
  clearAllMaterialContent,
  deleteMaterialContent,
  saveMaterialContent,
} from '../lib/materialStorage';
import { loadCloudLibrary } from '../lib/cloud/library';
import { upsertSubject } from '../lib/cloud/subjectsRepository';
import {
  createMaterialSignedUrl,
  deleteMaterial,
  writeMaterial,
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
import { setStorageScope } from '../lib/storageScope';
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
import { CheckCircle2 } from 'lucide-react';

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

        // Mirror the server library into the local cache for offline reads.
        saveStoredSubjects(result.data.subjects);
        saveStoredMaterials(result.data.materials);
        for (const material of result.data.materials) {
          if (
            material.parsedMarkdown !== undefined ||
            material.rawText !== undefined ||
            material.pages !== undefined
          ) {
            await saveMaterialContent(material.id, {
              markdown: material.parsedMarkdown ?? '',
              rawText: material.rawText,
              pages: material.pages,
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
        setMaterials(result.data.materials);
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

  const selectedConcept = useMemo(() => {
    return (
      subjectConcepts.find((c) => c.id === selectedConceptId) ||
      subjectConcepts[0]
    );
  }, [subjectConcepts, selectedConceptId]);

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

    showToast(`과목이 [${targetSubject?.name || '새 과목'}]으로 전환되었습니다.`);
  };

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

  // Material Add Handler — uploads original + body to Storage and metadata to DB.
  // Returns true only after the server confirms, so the upload modal can keep
  // the form open on failure.
  const handleAddMaterial = async (
    newMat: Material,
    originalFile?: File,
    jobId?: string
  ): Promise<boolean> => {
    const content = {
      markdown: newMat.parsedMarkdown ?? '',
      rawText: newMat.rawText,
      pages: newMat.pages,
    };
    const result = await writeMaterial({
      material: newMat,
      content,
      original: originalFile
        ? { blob: originalFile, contentType: originalFile.type || 'application/pdf' }
        : null,
      jobId,
    });
    if (!result.ok) {
      showToast(`자료 서버 저장 실패: ${result.error}`);
      return false;
    }
    const updated = [newMat, ...materials];
    setMaterials(updated);
    saveStoredMaterials(updated);
    showToast(`자료 [${newMat.title}]가 서버에 등록되었습니다.`);
    return true;
  };

  // Stage 2: AI Concept Analysis Handler
  const handleTriggerAiAnalysis = async (targetMaterial: Material) => {
    if (!targetMaterial.parsedMarkdown || !targetMaterial.parsedMarkdown.trim()) {
      showToast('검토 및 저장된 Markdown 내용이 없습니다. 먼저 자료를 저장해주세요.');
      return;
    }
    if (targetMaterial.status !== 'ready') {
      showToast('자료가 아직 변환 중이거나 오류 상태입니다. 저장 완료 후 분석할 수 있습니다.');
      return;
    }

    setIsAiAnalyzing(true);
    showToast(`[${targetMaterial.title}] AI 개념 분석 시작... (Gemini API 호출 중)`);

    try {
      const res = await fetch('/api/analyze-concepts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          materialId: targetMaterial.id,
          subjectId: targetMaterial.subjectId,
          domain: activeSubject?.domain || 'mathematics',
          markdown: targetMaterial.parsedMarkdown,
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

      const newDrafts: ConceptDraft[] = data.drafts || [];
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
    setIsProblemSessionOpen(true);
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
    const syncEvent = updatedConcept?.events.find((e) => e.attemptId === attempt.id);
    if (syncEvent && isSupabaseConfigured()) {
      void (async () => {
        try {
          const supabase = createBrowserSupabaseClient();
          const submitted = await submitAttemptCloud(
            supabase,
            attempt,
            syncEvent,
            attempt.planItemId ?? null,
            null
          );
          if (!submitted.ok) {
            showToast(`풀이는 로컬에 저장됐지만 서버 저장에 실패했습니다: ${submitted.error}`);
          }
        } catch (e) {
          showToast(`풀이 서버 저장 실패: ${e instanceof Error ? e.message : '알 수 없는 오류'}`);
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
    setActiveRechallengeReservationId(null);
    setActivePlanItemIdForSession(null);
    setLogicTarget(null);
    setIsProblemSessionOpen(true);
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

  const handlePostponePlanItem = (item: StudyPlanItem) => {
    const currentAssigned = item.assignedDate || toSeoulDateString(new Date());
    const nextDate = toSeoulDateString(addDaysToDate(currentAssigned, 1));
    const updated = postponeStudyPlanItem(item.id, nextDate);
    setStudyPlanItems(updated);
    showToast(`[${item.snapshotTitle}] 일정이 내일(${nextDate})로 미뤄졌습니다. (학습 점수 불변)`);
  };

  const handleSkipPlanItem = (item: StudyPlanItem) => {
    const updated = skipStudyPlanItem(item.id);
    setStudyPlanItems(updated);
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

  // Scroll to Today Review panel
  const handleScrollToTodayReview = () => {
    const el = document.getElementById('today-review-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
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
        onOpenMaterialsList={() => setIsMaterialsListOpen(true)}
        onOpenConceptReview={() => {
          setConceptReviewMaterial(null);
          setIsConceptReviewOpen(true);
        }}
        draftCount={activeSubjectDrafts.length}
        onOpenProblemGenerator={() => setIsProblemGeneratorOpen(true)}
        onOpenProblemReview={() => setIsProblemReviewOpen(true)}
        problemDraftCount={activeSubjectProblemDrafts.length}
        problemReportedCount={activeSubjectReportedCount}
        onOpenProblemSession={() => {
          if (!activeSessionProblem) {
            showToast('선택 개념에 연결된 출제 가능한 문제가 없습니다. 문제를 생성·승인해 주세요.');
            return;
          }
          setActiveRechallengeReservationId(null);
          setActivePlanItemIdForSession(null);
          setIsProblemSessionOpen(true);
        }}
        onOpenMockExam={() => {
          // 일반 메뉴에서 시작: 계획 설정 없이 기본값을 사용한다.
          setMockExamInitialConfig(null);
          setIsMockExamModalOpen(true);
        }}
        onOpenStudyPlan={() => setIsStudyPlanOpen(true)}
        onOpenLearningAnalytics={() => setIsLearningAnalyticsOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onScrollToTodayReview={handleScrollToTodayReview}
        userEmail={currentUser.email}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
      />

      {materials.filter((m) => m.subjectId === activeSubject.id).length === 0 && (
        <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
            <p className="text-xs text-[#57544e] leading-relaxed">
              이 과목에는 아직 학습 자료가 없습니다. PDF 또는 강의 전사본을 등록하면 자료 분석과
              문제 생성이 시작됩니다.
            </p>
            <button
              type="button"
              onClick={() => setIsUploadModalOpen(true)}
              className="shrink-0 text-xs font-semibold bg-[#191817] text-white px-3 py-1.5 rounded-xs hover:bg-[#33302b] transition-colors"
            >
              자료 등록
            </button>
          </div>
        </div>
      )}

      {legacyImportState &&
        legacyImportState.hasLegacyData &&
        !legacyImportState.imported &&
        !legacyImportState.declined &&
        (legacyImportState.conflict ? (
          <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-xs text-[#57544e] leading-relaxed">
                <span className="font-bold text-[#191817]">기존 공용 학습 기록이 있습니다.</span>{' '}
                이미 이 계정에 학습 기록이 있어 자동으로 가져오지 않습니다. 두 기록을 섞으면
                과목·자료 연결이 깨질 수 있어 현재 계정 기록을 그대로 유지합니다.
              </div>
              <button
                type="button"
                onClick={handleDeclineLegacy}
                className="shrink-0 text-xs text-[#57544e] border border-[#c8c2b5] bg-white px-3 py-1.5 rounded-xs hover:bg-[#faf8f4] transition-colors"
              >
                확인
              </button>
            </div>
          </div>
        ) : (
          <div className="w-full bg-[#fef2f2] border-b border-[#f3c6c6]">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-xs text-[#57544e] leading-relaxed">
                <span className="font-bold text-[#c52828]">
                  {legacyImportState.resume
                    ? '중단된 가져오기를 이어서 완료할 수 있습니다.'
                    : '기존 학습 기록을 발견했습니다.'}
                </span>{' '}
                {legacyImportState.resume
                  ? '이미 복사된 기록은 원본과 일치하는지 검증한 뒤 건너뛰고, 남은 기록만 복사합니다. 기존 공용 기록과 현재 계정 기록은 그대로 보존됩니다.'
                  : '이 계정으로 가져오면 로그인 후에도 동일한 기록을 이어서 사용할 수 있습니다. 기존 공용 기록은 그대로 보존되며, 다른 계정에는 표시되지 않습니다.'}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleImportLegacy}
                  disabled={isImportingLegacy}
                  className="text-xs font-semibold bg-[#c52828] text-white px-3 py-1.5 rounded-xs hover:bg-[#a81f1f] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isImportingLegacy
                    ? '가져오는 중...'
                    : legacyImportState.resume
                      ? '가져오기 계속하기'
                      : '기존 학습 기록 가져오기'}
                </button>
                <button
                  type="button"
                  onClick={handleDeclineLegacy}
                  disabled={isImportingLegacy}
                  className="text-xs text-[#57544e] border border-[#c8c2b5] bg-white px-3 py-1.5 rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                >
                  나중에
                </button>
              </div>
            </div>
          </div>
        ))}

      {cloudMigrationState &&
        cloudMigrationState.hasLocalData &&
        !cloudMigrationState.imported &&
        !cloudMigrationState.declined && (
          <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-xs text-[#57544e] leading-relaxed">
                <span className="font-bold text-[#191817]">이 계정의 로컬 과목·자료를 클라우드로 이전할 수 있습니다.</span>{' '}
                이전하면 다른 기기에서도 같은 과목·자료를 사용할 수 있습니다. 로컬 원본은 그대로
                보존되며, 같은 ID의 다른 내용은 자동으로 덮어쓰지 않습니다. (문제·답안·복습 이력은
                아직 로컬에 남습니다.)
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleMigrateCloud}
                  disabled={isMigratingCloud}
                  className="text-xs font-semibold bg-[#191817] text-white px-3 py-1.5 rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
          </div>
        )}

      {learningMigrationState &&
        learningMigrationState.hasLocalData &&
        !learningMigrationState.imported &&
        !learningMigrationState.declined && (
          <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-xs text-[#57544e] leading-relaxed">
                <span className="font-bold text-[#191817]">로컬 개념·문제·버전을 클라우드로 이전할 수 있습니다.</span>{' '}
                이전하면 다른 기기에서도 승인한 개념과 문제를 이어서 사용할 수 있습니다. 로컬 원본은 그대로
                보존되며, 같은 ID의 다른 내용은 자동으로 덮어쓰지 않습니다. (답안·복습 이력은 이번 단계에서
                로컬에 남습니다.) 과목·자료 이전을 먼저 완료해야 합니다.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleMigrateLearning}
                  disabled={isMigratingLearning}
                  className="text-xs font-semibold bg-[#191817] text-white px-3 py-1.5 rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isMigratingLearning ? '이전 중...' : '학습 콘텐츠 이전'}
                </button>
                <button
                  type="button"
                  onClick={handleDeclineLearning}
                  disabled={isMigratingLearning}
                  className="text-xs text-[#57544e] border border-[#c8c2b5] bg-white px-3 py-1.5 rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                >
                  나중에
                </button>
              </div>
            </div>
          </div>
        )}

      {historyMigrationState &&
        historyMigrationState.hasLocalData &&
        !historyMigrationState.imported &&
        !historyMigrationState.declined && (
          <div className="w-full bg-[#fbf9f5] border-b border-[#e2ded6]">
            <div className="max-w-[1440px] mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
              <div className="text-xs text-[#57544e] leading-relaxed">
                <span className="font-bold text-[#191817]">로컬 풀이·복습·계획·모의시험 이력을 클라우드로 이전할 수 있습니다.</span>{' '}
                이전하면 다른 기기에서도 기존 풀이 기록과 진행 중인 모의시험을 이어갈 수 있습니다. 로컬
                원본은 서버 반영이 검증될 때까지 그대로 보존됩니다.
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleMigrateHistory}
                  disabled={isMigratingHistory}
                  className="text-xs font-semibold bg-[#191817] text-white px-3 py-1.5 rounded-xs hover:bg-[#33302b] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isMigratingHistory ? '이전 중...' : '학습 이력 이전'}
                </button>
                <button
                  type="button"
                  onClick={handleDeclineHistory}
                  disabled={isMigratingHistory}
                  className="text-xs text-[#57544e] border border-[#c8c2b5] bg-white px-3 py-1.5 rounded-xs hover:bg-[#faf8f4] transition-colors disabled:opacity-60"
                >
                  나중에
                </button>
              </div>
            </div>
          </div>
        )}

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Section 1: Subject Exam Record & D-Day */}
        <ExamRecordCard
          subject={activeSubject}
          materialCount={materials.filter((m) => m.subjectId === activeSubject.id).length}
          onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
          onOpenScopeModal={() => setIsScopeModalOpen(true)}
          onOpenStudyPlanModal={() => setIsStudyPlanOpen(true)}
          onOpenUploadModal={() => setIsUploadModalOpen(true)}
          onOpenMaterialsListModal={() => setIsMaterialsListOpen(true)}
        />

        {/* Section 2: Status Strip */}
        <StatusStrip
          subject={activeSubject}
          concepts={subjectConcepts}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
        />

        {/* Section 3: Concept Rail (Table 1.0) */}
        <ConceptRail
          concepts={subjectConcepts}
          selectedConceptId={selectedConceptId}
          onSelectConcept={handleSelectConcept}
          sortMode={sortMode}
          onChangeSortMode={setSortMode}
          isComparisonMode={isComparisonMode}
          comparedConceptIds={comparedConceptIds}
          onToggleCompareConcept={handleToggleCompareConcept}
        />

        {/* Section 4: Main 2-Column Split (Left: Chart & Archive Record / Right: Today Review) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left Column (Approx 65% width: 8 of 12 cols) */}
          <div className="lg:col-span-8 space-y-4">
            {/* SVG Forgetting Curve Chart */}
            {selectedConcept && (
              <ForgettingCurveChart
                concept={selectedConcept}
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
                examDayOffset={examDDay}
                hasExamDate={Boolean(activeSubject.examAt && !isNaN(new Date(activeSubject.examAt).getTime()))}
              />
            )}

            {/* Archive Record Detail Box */}
            {selectedConcept && (
              <ArchiveRecordDetail
                concept={selectedConcept}
                event={selectedEvent}
                attempts={attempts}
                problems={allProblems}
                onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
                onReportProblem={handleReportProblem}
                onOpenLogicStrengthen={handleOpenLogicStrengthen}
              />
            )}
          </div>

          {/* Right Column (Approx 35% width: 4 of 12 cols) */}
          <div className="lg:col-span-4 sticky top-16">
            {selectedConcept && (
              <TodayReviewPanel
                subject={activeSubject}
                concept={selectedConcept}
                problems={subjectProblems}
                selectedProblemType={selectedProblemType}
                onSelectProblemType={setSelectedProblemType}
                onStartSession={(problemId) => {
                  if (problemId) {
                    setActiveProblemIdForSession(problemId);
                  }
                  setActiveRechallengeReservationId(null);
                  setActivePlanItemIdForSession(null);
                  setIsProblemSessionOpen(true);
                }}
                onPostponeDay={handlePostponeDay}
                onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
                onOpenProblemGenerator={(conceptId) => {
                  if (conceptId) {
                    setSelectedConceptId(conceptId);
                  }
                  setIsProblemGeneratorOpen(true);
                }}
                onOpenProblemReview={() => setIsProblemReviewOpen(true)}
                problemDraftCount={activeSubjectProblemDrafts.length}
                recommendation={selectedConceptRecommendation}
                totalConceptsCount={subjectConcepts.length}
              />
            )}
          </div>
        </div>

        {/* Notice Banner */}
        <div className="bg-[#f6f3eb] border border-[#ded6c8] p-3 rounded-xs text-[11px] font-academic-mono text-[#57544e] flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
          <div>
            <strong className="text-[#191817]">NOTE:</strong> 시험 일정 변경 시 이전 학습 데이터 및 풀이 기록은 무결하게 보존되며 감쇠 계수 곡선만 즉시 재산출됩니다.
          </div>
          <div className="text-[#827d73] shrink-0">
            TIMEZONE: ASIA/SEOUL (UTC+09:00) · SCHEDULER: 00:00:00 KST SYNC
          </div>
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
            <span>ENGINE: POWER-LAW v2.4</span>
            <span className="text-[#c8c2b5]">·</span>
            <span>EVALUATION ADAPTER: RUBRIC-3D</span>
            <span className="text-[#c8c2b5]">·</span>
            <button
              onClick={() => setIsSettingsModalOpen(true)}
              className="hover:text-[#191817] underline decoration-dotted"
            >
              모델 설정
            </button>
          </div>
        </div>
      </footer>

      {/* Modals */}
      {/* 1. Problem Session Workspace Modal */}
      {isProblemSessionOpen && sessionConcept && activeSessionProblem && (
        <ProblemSessionModal
          key={`${activeSubject.id}-${activeSessionProblem.id}-${activeSessionProblem.version ?? 1}`}
          isOpen={isProblemSessionOpen}
          onClose={() => {
            setIsProblemSessionOpen(false);
            setActiveProblemIdForSession(null);
            setActiveRechallengeReservationId(null);
            setActivePlanItemIdForSession(null);
          }}
          subject={activeSubject}
          concept={sessionConcept}
          problem={activeSessionProblem}
          onSubmitAttempt={handleSubmitAttempt}
          rechallengeReservationId={activeRechallengeReservationId || undefined}
          planItemId={activePlanItemIdForSession || undefined}
          onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
          onReportProblem={handleReportProblem}
        />
      )}

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
        onDeleteMaterial={async (materialId) => {
          // Delete on the server first; never report success on failure.
          const result = await deleteMaterial(materialId);
          if (!result.ok) {
            showToast(`자료 삭제 실패: ${result.error}`);
            return;
          }
          const updated = materials.filter((m) => m.id !== materialId);
          setMaterials(updated);
          saveStoredMaterials(updated);
          const localCleanup = await deleteMaterialContent(materialId);
          showToast(
            localCleanup.deleted
              ? '자료와 저장된 본문이 삭제되었습니다.'
              : `서버에서는 삭제됐지만 브라우저 캐시 정리에 실패했습니다. (${localCleanup.error || '알 수 없는 오류'})`
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
        onSave={async (updatedMat, updatedContent) => {
          // Persist a new version to the server before updating local state.
          const writeResult = await writeMaterial({
            material: updatedMat,
            content: {
              markdown: updatedContent.markdown,
              rawText: updatedMat.rawText,
              pages: updatedContent.pages,
            },
          });
          if (!writeResult.ok) {
            showToast(`자료 수정 저장 실패: ${writeResult.error}`);
            return false;
          }

          const updated = materials.map((m) =>
            m.id === updatedMat.id ? updatedMat : m
          );
          setMaterials(updated);
          saveStoredMaterials(updated);
          setEditingMaterial(updatedMat);

          // Mark ONLY problems that actually referenced the edited material as outdated.
          // Problems with per-material hashes are compared per material; legacy problems
          // without per-material hashes are flagged as "needs source review" (not auto-outdated).
          const { updatedProblems: newProblems, outdatedIds, reviewIds } = applyMaterialEditToProblems(
            allProblems,
            updatedMat,
            allConcepts
          );
          setAllProblems(newProblems);
          saveStoredProblems(newProblems);

          if (outdatedIds.length > 0) {
            showToast(
              `[${updatedMat.title}] 수정으로 문제 ${outdatedIds.length}건이 구버전으로 표시되어 재검토가 필요합니다.`
            );
          } else if (reviewIds.length > 0) {
            showToast(
              `[${updatedMat.title}] 수정과 연관된 문제 ${reviewIds.length}건을 확인 필요 상태로 표시했습니다.`
            );
          } else {
            showToast(`[${updatedMat.title}] 수정 내용이 서버에 저장되었습니다.`);
          }
          return true;
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
      />

      {/* 7. Mock Exam Modal */}
      {isMockExamModalOpen && <MockExamModal
        key={activeSubject.id}
        isOpen={isMockExamModalOpen}
        onClose={() => {
          setIsMockExamModalOpen(false);
          setMockExamInitialConfig(null);
        }}
        subject={activeSubject}
        concepts={subjectConcepts}
        problems={availableSubjectProblems}
        initialConfig={mockExamInitialConfig}
        onExamRecorded={() => {
          setAllConcepts(loadStoredConcepts());
          setAttempts(loadStoredAttempts());
          setMockExams(loadMockExams());
          showToast('모의시험 답안과 평가가 학습 이력에 저장되었습니다.');
        }}
      />}

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

