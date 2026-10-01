'use client';

import React, { useState, useEffect, useMemo, useSyncExternalStore } from 'react';
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
} from '../lib/types';
import {
  loadStoredSubjects,
  saveStoredSubjects,
  loadActiveSubjectId,
  saveActiveSubjectId,
  loadStoredMaterials,
  saveStoredMaterials,
  loadStoredConcepts,
  loadStoredConceptDrafts,
  saveStoredConceptDrafts,
  loadStoredProblems,
  saveStoredProblems,
  loadStoredProblemDrafts,
  saveStoredProblemDrafts,
  approveProblemDraft,
  batchApproveProblemDrafts,
  deleteProblemDraft,
  updateProblemDraft,
  loadStoredAttempts,
  loadStoredSettings,
  saveStoredSettings,
  recordAttemptAndUpdateConcept,
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
  postponeStudyPlanItem,
  skipStudyPlanItem,
  loadStoredPersonalizationSettings,
  saveStoredPersonalizationSettings,
  saveStoredPersonalizationState,
} from '../lib/storage';
import {
  DEFAULT_RETENTION_SETTINGS,
  rankConceptsForReview,
} from '../lib/retentionModel';
import { generateStudyPlan } from '../lib/studyPlan';
import { computeCorrectionState, getEffectiveIntervalMultiplier } from '../lib/personalization';
import { loadMockExams } from '../lib/mockExam';
import { LearningAnalyticsModal } from '../components/LearningAnalyticsModal';
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
import { MockExamModal } from '../components/MockExamModal';
import { AddSubjectModal } from '../components/AddSubjectModal';
import { StudyPlanModal } from '../components/StudyPlanModal';
import { calculateDDay, toSeoulDateString, addDaysToDate } from '../lib/dateUtils';
import { clearAllMaterialContent, deleteMaterialContent } from '../lib/materialStorage';
import { applyMaterialEditToProblems } from '../lib/problemFreshness';
import { CheckCircle2 } from 'lucide-react';

// Stable no-op subscription used only to detect client hydration.
const hydrationSubscribe = () => () => {};

export default function RedcallDashboardPage() {
  // Hydration safety flag
  const [isLoaded, setIsLoaded] = useState(false);

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

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3800);
  };

  // Hydration-safe flag: false during SSR/first hydration commit, true after.
  const isHydrated = useSyncExternalStore(hydrationSubscribe, () => true, () => false);

  // Initial load runs during a guarded render phase rather than inside an effect.
  // This avoids cascading renders while remaining hydration-safe (the first client
  // commit still matches the server render).
  if (isHydrated && !isLoaded) {
    setIsLoaded(true);

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
    });
  }, [subjects, allConcepts, allProblems, attempts, studyPlanSettings, settings, studyPlanItems, intervalMultiplier, personalizationNote]);

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

  // Add Subject Handler (Stage 0)
  const handleAddSubject = (newSubject: Subject) => {
    const updated = [...subjects, newSubject];
    setSubjects(updated);
    saveStoredSubjects(updated);
    handleSelectSubject(newSubject.id);
    showToast(`새 과목 폴더 [${newSubject.name}]이 생성되었습니다.`);
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

  // Subject Update Handler (Schedule, Scope, etc.)
  const handleUpdateSubject = (updated: Subject) => {
    const newSubjects = subjects.map((s) => (s.id === updated.id ? updated : s));
    setSubjects(newSubjects);
    saveStoredSubjects(newSubjects);
    showToast('과목 시험 정보가 성공적으로 갱신되었습니다.');
  };

  // Material Add Handler
  const handleAddMaterial = (newMat: Material) => {
    const updated = [newMat, ...materials];
    setMaterials(updated);
    saveStoredMaterials(updated);
    showToast(`자료 [${newMat.title}]가 등록되었습니다.`);
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
    showToast(`[${targetMaterial.title}] AI 개념 분석 시작... (OpenAI/DeepSeek API 호출 중)`);

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

  const handleApproveProblemDraft = (draftId: string) => {
    const { approvedProblem, updatedDrafts, updatedProblems } = approveProblemDraft(draftId);
    if (approvedProblem) {
      setProblemDrafts(updatedDrafts);
      setAllProblems(updatedProblems);
      showToast(`문제 [${approvedProblem.title}]이(가) 승인되어 풀이 목록에 등록되었습니다.`);
    }
  };

  const handleBatchApproveProblemDrafts = (draftIds: string[]) => {
    const { approvedCount, updatedDrafts, updatedProblems } = batchApproveProblemDrafts(draftIds);
    setProblemDrafts(updatedDrafts);
    setAllProblems(updatedProblems);
    showToast(`선택한 문제 ${approvedCount}건이 승인 완료되어 풀이에 등록되었습니다.`);
  };

  const handleUpdateProblemDraft = (updatedDraft: ProblemDraft) => {
    const updated = updateProblemDraft(updatedDraft);
    setProblemDrafts(updated);
    showToast('문제 초안 수정 내용이 저장되었습니다.');
  };

  const handleDeleteProblemDraft = (draftId: string) => {
    const updated = deleteProblemDraft(draftId);
    setProblemDrafts(updated);
    showToast('문제 초안이 삭제되었습니다.');
  };

  const handleStartPracticeFromDraft = (draft: ProblemDraft) => {
    let problemToPracticeId = '';
    if (!draft.isApproved) {
      const { approvedProblem, updatedDrafts, updatedProblems } = approveProblemDraft(draft.id);
      if (approvedProblem) {
        problemToPracticeId = approvedProblem.id;
        setProblemDrafts(updatedDrafts);
        setAllProblems(updatedProblems);
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
    const res = editAndReviseProblem(problemId, updates, editReason);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
      showToast('문제가 수정되어 새 버전으로 기록되었습니다. (수정 후 재검토 상태)');
    } else {
      showToast(`문제 수정 실패: ${res.error}`);
    }
    return res;
  };

  const handleReapproveProblem = (problemId: string, reapprovalNote?: string) => {
    const res = reapproveProblem(problemId, reapprovalNote);
    if (res.success) {
      const reloadedProblems = loadStoredProblems();
      setAllProblems(reloadedProblems);
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
      showToast('문제가 사용 중지 처리되었습니다.');
    }
  };

  // Attempt Submission Handler (Updates ReviewEvent & Retention Score)
  const handleSubmitAttempt = (attempt: Attempt) => {
    const { updatedConcepts, updatedAttempts } = recordAttemptAndUpdateConcept(attempt, settings);
    setAllConcepts(updatedConcepts);
    setAttempts(updatedAttempts);
    setStudyPlanItems(loadStoredStudyPlanItems()); // Sync Stage 9 plan items

    // Set selected event to the newly added event
    const updatedConcept = updatedConcepts.find((c) => c.id === attempt.conceptId);
    if (updatedConcept && updatedConcept.events.length > 0) {
      const newEvent = updatedConcept.events[updatedConcept.events.length - 1];
      setSelectedEventId(newEvent.id);
    }

    showToast(`복습 제출 완료! 모델 점수가 ${attempt.calculatedScore}점으로 즉시 갱신되었습니다.`);
  };

  // Stage 9: Study Plan Handlers
  const handleStartPlanItem = (item: StudyPlanItem) => {
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
      setIsStudyPlanOpen(false);
      setIsMockExamModalOpen(true);
      showToast(`[${item.subjectName}] 실전 모의시험을 시작합니다.`);
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

  if (!isLoaded || !activeSubject) {
    return (
      <div className="min-h-screen bg-[#faf8f4] flex items-center justify-center p-6 text-sm font-academic-mono text-[#827d73]">
        REDCALL Academic Suite 초기화 중...
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
          setIsProblemSessionOpen(true);
        }}
        onOpenMockExam={() => setIsMockExamModalOpen(true)}
        onOpenStudyPlan={() => setIsStudyPlanOpen(true)}
        onOpenLearningAnalytics={() => setIsLearningAnalyticsOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onScrollToTodayReview={handleScrollToTodayReview}
      />

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
            <span className="font-bold text-[#191817]">REDCALL ACADEMIC SYSTEM</span>
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
          }}
          subject={activeSubject}
          concept={sessionConcept}
          problem={activeSessionProblem}
          onSubmitAttempt={handleSubmitAttempt}
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
        onDeleteMaterial={async (materialId) => {
          const updated = materials.filter((m) => m.id !== materialId);
          setMaterials(updated);
          saveStoredMaterials(updated);
          const result = await deleteMaterialContent(materialId);
          showToast(
            result.deleted
              ? '자료와 저장된 본문이 삭제되었습니다.'
              : `자료 목록에서는 제거했지만 본문 저장소 정리에 실패했습니다. (${result.error || '알 수 없는 오류'})`
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
        onSave={(updatedMat) => {
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
            showToast(`[${updatedMat.title}] 수정 내용이 저장되었습니다.`);
          }
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
        onClose={() => setIsMockExamModalOpen(false)}
        subject={activeSubject}
        concepts={subjectConcepts}
        problems={availableSubjectProblems}
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
    </div>
  );
}
