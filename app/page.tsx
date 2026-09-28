'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  approveProblemDraft,
  batchApproveProblemDrafts,
  deleteProblemDraft,
  updateProblemDraft,
  loadStoredAttempts,
  loadStoredSettings,
  saveStoredSettings,
  recordAttemptAndUpdateConcept,
  resetToInitialDemoData,
} from '../lib/storage';
import { DEFAULT_RETENTION_SETTINGS } from '../lib/retentionModel';
import { computeMarkdownHash } from '../lib/markdownUtils';
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
import { calculateDDay } from '../lib/dateUtils';
import { CheckCircle2, Info } from 'lucide-react';

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

  // Toast Notification
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3800);
  };

  // Initial Load from LocalStorage
  useEffect(() => {
    const loadedSubjects = loadStoredSubjects();
    const loadedSubjectId = loadActiveSubjectId();
    const loadedMaterials = loadStoredMaterials();
    const loadedConcepts = loadStoredConcepts();
    const loadedDrafts = loadStoredConceptDrafts();
    const loadedProblems = loadStoredProblems();
    const loadedProblemDrafts = loadStoredProblemDrafts();
    const loadedAttempts = loadStoredAttempts();
    const loadedSettings = loadStoredSettings();

    setSubjects(loadedSubjects);
    setActiveSubjectId(loadedSubjectId);
    setMaterials(loadedMaterials);
    setAllConcepts(loadedConcepts);
    setConceptDrafts(loadedDrafts);
    setAllProblems(loadedProblems);
    setProblemDrafts(loadedProblemDrafts);
    setAttempts(loadedAttempts);
    setSettings(loadedSettings);

    // Initial concept selection
    const subjectConcepts = loadedConcepts.filter((c) => c.subjectId === loadedSubjectId);
    if (subjectConcepts.length > 0) {
      const firstConcept = subjectConcepts[0];
      setSelectedConceptId(firstConcept.id);
      const lastEvent = firstConcept.events[firstConcept.events.length - 1];
      if (lastEvent) {
        setSelectedEventId(lastEvent.id);
      }
    }

    setIsLoaded(true);
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

  const activeSessionProblem = useMemo(() => {
    if (activeProblemIdForSession) {
      const found = subjectProblems.find((p) => p.id === activeProblemIdForSession);
      if (found) return found;
    }
    return (
      subjectProblems.find((p) => p.type === selectedProblemType) ||
      subjectProblems[0]
    );
  }, [subjectProblems, activeProblemIdForSession, selectedProblemType]);

  const selectedConcept = useMemo(() => {
    return (
      subjectConcepts.find((c) => c.id === selectedConceptId) ||
      subjectConcepts[0] ||
      allConcepts[0]
    );
  }, [subjectConcepts, selectedConceptId, allConcepts]);

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

  // Subject Switch Handler
  const handleSelectSubject = (newSubjectId: string) => {
    setActiveSubjectId(newSubjectId);
    saveActiveSubjectId(newSubjectId);

    // Select first concept in new subject
    const newConcepts = allConcepts.filter((c) => c.subjectId === newSubjectId);
    if (newConcepts.length > 0) {
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
    } catch (err: any) {
      showToast(`네트워크 또는 서버 오류: ${err?.message || '알 수 없는 오류'}`);
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

  // Attempt Submission Handler (Updates ReviewEvent & Retention Score)
  const handleSubmitAttempt = (attempt: Attempt) => {
    const { updatedConcepts, updatedAttempts } = recordAttemptAndUpdateConcept(attempt, settings);
    setAllConcepts(updatedConcepts);
    setAttempts(updatedAttempts);

    // Set selected event to the newly added event
    const updatedConcept = updatedConcepts.find((c) => c.id === attempt.conceptId);
    if (updatedConcept && updatedConcept.events.length > 0) {
      const newEvent = updatedConcept.events[updatedConcept.events.length - 1];
      setSelectedEventId(newEvent.id);
    }

    showToast(`복습 제출 완료! 모델 점수가 ${attempt.calculatedScore}점으로 즉시 갱신되었습니다.`);
  };

  // Postpone 1 day
  const handlePostponeDay = () => {
    showToast(`[${selectedConcept?.title || '개념'}]의 권장 복습일정이 +1일 연기되었습니다.`);
  };

  // Scroll to Today Review panel
  const handleScrollToTodayReview = () => {
    const el = document.getElementById('today-review-panel');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // Reset to initial demo data
  const handleResetData = () => {
    resetToInitialDemoData();
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
        onOpenProblemSession={() => setIsProblemSessionOpen(true)}
        onOpenMockExam={() => setIsMockExamModalOpen(true)}
        onOpenSettings={() => setIsSettingsModalOpen(true)}
        onScrollToTodayReview={handleScrollToTodayReview}
        activeView="dashboard"
      />

      {/* Main Workspace Container */}
      <main className="flex-1 max-w-[1440px] w-full mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4">
        {/* Section 1: Subject Exam Record & D-Day */}
        <ExamRecordCard
          subject={activeSubject}
          materialCount={materials.filter((m) => m.subjectId === activeSubject.id).length}
          onOpenScheduleModal={() => setIsScheduleModalOpen(true)}
          onOpenScopeModal={() => setIsScopeModalOpen(true)}
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
              />
            )}

            {/* Archive Record Detail Box */}
            {selectedConcept && (
              <ArchiveRecordDetail
                concept={selectedConcept}
                event={selectedEvent}
                attempts={attempts}
                onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
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
                onStartSession={() => setIsProblemSessionOpen(true)}
                onPostponeDay={handlePostponeDay}
                onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
                onOpenProblemGenerator={() => setIsProblemGeneratorOpen(true)}
                onOpenProblemReview={() => setIsProblemReviewOpen(true)}
                problemDraftCount={activeSubjectProblemDrafts.length}
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
      {selectedConcept && (
        <ProblemSessionModal
          isOpen={isProblemSessionOpen}
          onClose={() => {
            setIsProblemSessionOpen(false);
            setActiveProblemIdForSession(null);
          }}
          subject={activeSubject}
          concept={selectedConcept}
          problem={activeSessionProblem}
          onSubmitAttempt={handleSubmitAttempt}
          onOpenSourceModal={(sourceRef) => setPdfViewerSourceRef(sourceRef)}
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
        onDeleteMaterial={(materialId) => {
          const updated = materials.filter((m) => m.id !== materialId);
          setMaterials(updated);
          saveStoredMaterials(updated);
          showToast('자료가 삭제되었습니다.');
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
      <MaterialEditorModal
        isOpen={isMaterialEditorOpen && !!editingMaterial}
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

          // Mark problems created from prior version of markdown as outdated
          const newHash = computeMarkdownHash(updatedMat.parsedMarkdown || '');
          const newProblems = allProblems.map((p) => {
            if (p.subjectId === updatedMat.subjectId && p.sourceMarkdownHash && p.sourceMarkdownHash !== newHash) {
              return { ...p, isOutdated: true };
            }
            return p;
          });
          setAllProblems(newProblems);
          saveStoredProblems(newProblems);

          showToast(`[${updatedMat.title}] 수정 내용이 저장되었습니다.`);
        }}
        onOpenConceptReview={(mat) => {
          setConceptReviewMaterial(mat || null);
          setIsConceptReviewOpen(true);
        }}
        onTriggerAnalysis={handleTriggerAiAnalysis}
        isAnalyzing={isAiAnalyzing}
      />

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
      <PdfViewerModal
        isOpen={!!pdfViewerSourceRef}
        onClose={() => setPdfViewerSourceRef(null)}
        sourceRef={pdfViewerSourceRef || ''}
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
      <MockExamModal
        isOpen={isMockExamModalOpen}
        onClose={() => setIsMockExamModalOpen(false)}
        subject={activeSubject}
        concepts={subjectConcepts}
        onStartExamReview={() => {
          setIsProblemSessionOpen(true);
        }}
      />

      {/* 8. Add Subject Modal (Stage 0) */}
      <AddSubjectModal
        isOpen={isAddSubjectModalOpen}
        onClose={() => setIsAddSubjectModalOpen(false)}
        onAddSubject={handleAddSubject}
      />

      {/* 9. AI Problem Generator Modal (Stage 3) */}
      <ProblemGeneratorModal
        isOpen={isProblemGeneratorOpen}
        onClose={() => setIsProblemGeneratorOpen(false)}
        activeSubject={activeSubject}
        concepts={subjectConcepts}
        selectedConceptId={selectedConceptId}
        onGenerateSuccess={handleProblemGenerateSuccess}
        sourceMarkdown={
          materials.find((m) => m.subjectId === activeSubject.id && m.parsedMarkdown)?.parsedMarkdown
        }
      />

      {/* 10. AI Problem Review & Approval Modal (Stage 3) */}
      <ProblemReviewModal
        isOpen={isProblemReviewOpen}
        onClose={() => setIsProblemReviewOpen(false)}
        activeSubject={activeSubject}
        drafts={problemDrafts}
        concepts={subjectConcepts}
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
      />
    </div>
  );
}
