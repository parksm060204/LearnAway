'use client';

import React, { useState } from 'react';
import {
  GraduationCap,
  BookOpen,
  FileText,
  Sparkles,
  PenTool,
  Calendar,
  ArrowRight,
  Plus,
  HelpCircle,
  Clock,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useTrialCredits } from '../lib/trialCreditsClient';

interface OnboardingFlowProps {
  onOpenAddSubject: () => void;
  onLoadDemoData?: () => void;
  userEmail?: string | null;
  onOpenAiSettings?: () => void;
}

export function OnboardingFlow({
  onOpenAddSubject,
  onLoadDemoData,
  userEmail,
  onOpenAiSettings,
}: OnboardingFlowProps) {
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);
  const trialCredits = useTrialCredits();

  const STEPS = [
    {
      num: 1,
      title: '과목 개설 및 시험일 등록',
      desc: '공부할 전공 과목을 생성하고 시험일을 지정합니다. D-Day에 맞춰 매일 최적의 학습 분량이 자동 배분됩니다.',
      icon: Calendar,
      badge: '시작 단계',
    },
    {
      num: 2,
      title: '강의자료 등록 (PDF / 전사본)',
      desc: '교재 PDF나 강의 녹음 전사본을 등록합니다. 브라우저 내 PDF.js로 안전하고 빠르게 텍스트와 수식을 추출합니다.',
      icon: FileText,
      badge: '자료 준비',
    },
    {
      num: 3,
      title: 'AI 개념 분석 & 핵심 추출',
      desc: '자료에서 시험에 출제될 핵심 개념과 정리를 추출합니다. 추출된 개념을 검토하고 내 과목 체계로 승인합니다.',
      icon: Sparkles,
      badge: '개념화',
    },
    {
      num: 4,
      title: '대학 시험 수준 문제 출제',
      desc: '단순 객관식이 아닌, 대학 중간/기말고사에 출제되는 서술형·계산형·증명형 및 복합 전이 문제를 생성합니다.',
      icon: Layers,
      badge: '문제화',
    },
    {
      num: 5,
      title: '답안 작성 및 AI 루브릭 채점',
      desc: '실제 시험처럼 풀이 과정과 답안을 작성하면 AI가 부분점수와 9대 학술 오답 원인을 정밀 진단합니다.',
      icon: PenTool,
      badge: '평가 및 피드백',
    },
    {
      num: 6,
      title: '에빙하우스 망각곡선 맞춤 복습',
      desc: '내 오답 유형과 기억 유지율 감쇠에 따라 오늘 복습할 맞춤형 문제가 자동으로 대시보드에 추천됩니다.',
      icon: Clock,
      badge: '장기 기억',
    },
  ];

  return (
    <div className="w-full max-w-4xl mx-auto py-6 sm:py-10 px-3 sm:px-6 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-br from-[#ffffff] to-[#faf8f4] border border-[#e2ded6] rounded-xs p-6 sm:p-8 shadow-xs relative overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 bg-[#c52828]/5 rounded-full blur-2xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-academic-mono bg-[#f4f1ea] border border-[#ded6c8] text-[#57544e]">
              <GraduationCap className="w-3.5 h-3.5 text-[#c52828]" />
              <span>대학 전공 시험 완벽 대비 솔루션</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-academic-serif text-[#191817]">
              {userEmail ? `${userEmail}님, ` : ''}LearnAway에 오신 것을 환영합니다
            </h1>
            <p className="text-xs sm:text-sm text-[#57544e] max-w-xl leading-relaxed">
              대학 시험 수준의 논술·증명·계산 문제를 풀고, AI 루브릭 채점과 에빙하우스 간격 반복을 통해 시험 전날까지 장기 기억을 완벽하게 완성하세요.
            </p>
          </div>

          {/* AI Credit status pill */}
          <div className="bg-white border border-[#ded6c8] rounded-xs p-3 shadow-2xs text-left sm:text-right shrink-0">
            <div className="text-[10px] font-academic-mono text-[#827d73] uppercase tracking-wider mb-0.5">
              AI 무료 체험 현황
            </div>
            <div className="text-xs font-bold text-[#191817] flex items-center gap-1.5 sm:justify-end">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>
                {trialCredits.loading
                  ? '크레딧 확인 중...'
                  : trialCredits.hasPersonalKey
                  ? '내 API 키 연결됨 (무제한)'
                  : `남은 무료 체험: ${trialCredits.balance}회`}
              </span>
            </div>
            {onOpenAiSettings && (
              <button
                type="button"
                onClick={onOpenAiSettings}
                className="text-[11px] text-[#c52828] hover:underline font-medium mt-1 inline-block"
              >
                {trialCredits.hasPersonalKey ? 'API 설정 관리' : '개인 API 키 연결 안내'}
              </button>
            )}
          </div>
        </div>

        {/* Primary Action Buttons */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 border-t border-[#f1ede4]">
          <button
            type="button"
            onClick={onOpenAddSubject}
            className="flex-1 px-5 py-3 bg-[#191817] hover:bg-[#33302b] text-white text-sm font-bold rounded-xs flex items-center justify-center gap-2 shadow-xs transition-colors focus-visible:ring-2 focus-visible:ring-[#191817]"
            aria-label="새 과목 생성하고 학습 시작하기"
          >
            <Plus className="w-4 h-4 text-[#c52828]" />
            <span>첫 과목 생성하고 학습 시작하기</span>
            <ArrowRight className="w-4 h-4 ml-1" />
          </button>

          {onLoadDemoData && (
            <button
              type="button"
              onClick={onLoadDemoData}
              className="px-4 py-3 bg-white hover:bg-[#faf8f4] border border-[#ded6c8] text-[#57544e] text-xs sm:text-sm font-semibold rounded-xs flex items-center justify-center gap-2 transition-colors focus-visible:ring-2 focus-visible:ring-[#ded6c8]"
              aria-label="체험용 샘플 과목 불러오기"
            >
              <BookOpen className="w-4 h-4 text-[#827d73]" />
              <span>체험용 샘플 과목 둘러보기</span>
            </button>
          )}
        </div>
      </div>

      {/* Guided 6-Step Workflow */}
      <div className="bg-white border border-[#e2ded6] rounded-xs p-6 shadow-2xs space-y-4">
        <div className="flex items-center justify-between border-b border-[#f1ede4] pb-3">
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold font-academic-serif text-[#191817] flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#c52828]" />
              <span>LearnAway 학습 표준 가이드라인</span>
            </h2>
            <p className="text-xs text-[#57544e]">
              복잡한 매뉴얼 없이 아래 6단계를 순서대로 진행하면 시험 대비 준비가 완료됩니다.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {STEPS.map((step) => {
            const IconComponent = step.icon;
            return (
              <div
                key={step.num}
                className="p-3.5 bg-[#faf8f4] border border-[#ded6c8] rounded-xs flex items-start gap-3 hover:border-[#c8c2b5] transition-colors"
              >
                <div className="w-8 h-8 rounded-xs bg-white border border-[#ded6c8] flex items-center justify-center shrink-0 font-bold font-academic-mono text-xs text-[#191817]">
                  {step.num}
                </div>
                <div className="space-y-1 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <h3 className="text-xs font-bold text-[#191817] flex items-center gap-1.5">
                      <IconComponent className="w-3.5 h-3.5 text-[#827d73]" />
                      <span>{step.title}</span>
                    </h3>
                    <span className="text-[10px] font-academic-mono px-1.5 py-0.2 rounded-2xs bg-white border border-[#ded6c8] text-[#827d73]">
                      {step.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#57544e] leading-relaxed">
                    {step.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Collapsible Architecture Explainer: Forgetting Curve & Evaluation */}
      <div className="bg-white border border-[#e2ded6] rounded-xs overflow-hidden shadow-2xs">
        <button
          type="button"
          onClick={() => setIsExplainerOpen(!isExplainerOpen)}
          className="w-full px-5 py-3.5 flex items-center justify-between text-left hover:bg-[#faf8f4] transition-colors"
          aria-expanded={isExplainerOpen}
          aria-label="학습 원리 및 정책 상세 설명 펼치기/접기"
        >
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-bold text-[#191817]">
              자주 묻는 질문: 망각곡선 모델과 AI 평가 정책
            </span>
          </div>
          {isExplainerOpen ? (
            <ChevronUp className="w-4 h-4 text-[#827d73]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#827d73]" />
          )}
        </button>

        {isExplainerOpen && (
          <div className="p-5 pt-1 border-t border-[#f1ede4] space-y-4 text-xs text-[#57544e] bg-[#faf8f4]">
            <div className="space-y-1">
              <h4 className="font-bold text-[#191817]">Q. 개념 숙련도(Mastery)와 기억 유지율(Retention)은 어떻게 다른가요?</h4>
              <p className="leading-relaxed">
                <strong>개념 숙련도</strong>는 문제를 정확히 증명하고 해결한 실력의 누적 점수이며, 시간이 지나도 줄어들지 않습니다. 반면 <strong>기억 유지율</strong>은 에빙하우스 망각곡선 공식에 따라 시간이 경과함에 따라 회상 확률이 자연 감쇠하는 지표입니다. 복습 엔진은 이 두 축을 분리하여 이미 숙련된 개념은 복습 문제로 빠르게 확인하고, 개념 결손이 있는 항목은 기초부터 재학습하도록 스케줄을 배정합니다.
              </p>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-[#191817]">Q. 무료 AI 체험 크레딧은 어떻게 운영되나요?</h4>
              <p className="leading-relaxed">
                게스트 계정에는 최초 1회, 일반 회원가입 시 총 3회의 무료 체험 크레딧이 제공됩니다. 무료 크레딧을 모두 소진한 후에도 과목 관리, 자료 등록, 망각곡선 복습 일정 확인 등의 모든 기능은 영구 무료로 이용하실 수 있으며, 개인 OpenAI 또는 DeepSeek API 키를 등록하시면 추가 운영자 과금 없이 무제한으로 AI 채점을 이용하실 수 있습니다.
              </p>
            </div>

            <div className="space-y-1">
              <h4 className="font-bold text-[#191817]">Q. 작성 중이던 답안이 실수로 날아가지 않나요?</h4>
              <p className="leading-relaxed">
                서술형 답안 및 수식 풀이 과정은 작성 즉시 브라우저 로컬 초안에 자동 저장됩니다. 모달을 실수로 닫거나 다른 탭으로 이동하더라도 문제 풀이 화면으로 돌아오면 작성하던 내용이 그대로 복원됩니다.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
