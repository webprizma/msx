import React, { useState } from 'react';
import { ROADMAP_STEPS, RoadmapStep } from '../data/guides';
import { CheckSquare, Square, Clock, ArrowRight, Lightbulb, CheckCircle2 } from 'lucide-react';

export const RoadmapPlan: React.FC = () => {
  const [completedTasks, setCompletedTasks] = useState<Record<string, boolean>>({});

  const toggleTask = (taskId: string) => {
    setCompletedTasks((prev) => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

  // Calculate overall progress
  const allTasksCount = ROADMAP_STEPS.reduce((acc, step) => acc + step.tasks.length, 0);
  const completedCount = Object.values(completedTasks).filter(Boolean).length;
  const progressPercent = Math.round((completedCount / allTasksCount) * 100);

  return (
    <div className="flex flex-col gap-6">
      {/* Plan Header & Progress Bar */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">
            Пошаговый план работ по запуску своего сервера MSX
          </h2>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
            Следуйте этому проверенному чек-листу, чтобы избежать типичных ошибок Smart TV и запустить свой медиа-сервер за 1 час.
          </p>
        </div>

        <div className="flex flex-col gap-1.5 md:w-56 shrink-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-400 font-medium">Прогресс выполнения:</span>
            <span className="text-sky-400 font-bold font-mono">{progressPercent}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div
              className="h-full bg-sky-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-500 text-right">
            {completedCount} из {allTasksCount} задач выполнено
          </span>
        </div>
      </div>

      {/* Steps List */}
      <div className="flex flex-col gap-4">
        {ROADMAP_STEPS.map((step) => {
          const stepTaskIds = step.tasks.map((_, i) => `step-${step.step}-task-${i}`);
          const isStepCompleted = stepTaskIds.every((id) => completedTasks[id]);

          return (
            <div
              key={step.step}
              className={`p-5 rounded-xl border transition-all ${
                isStepCompleted
                  ? 'bg-slate-900/50 border-emerald-500/30'
                  : 'bg-slate-900 border-slate-800'
              }`}
            >
              {/* Step Header */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                    isStepCompleted
                      ? 'bg-emerald-500 text-slate-950'
                      : 'bg-slate-800 text-sky-400 border border-slate-700'
                  }`}>
                    {isStepCompleted ? <CheckCircle2 className="w-4 h-4" /> : `0${step.step}`}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white tracking-tight">
                      {step.title}
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {step.summary}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800/80 text-[11px] text-slate-400 font-mono">
                  <Clock className="w-3.5 h-3.5 text-sky-400" />
                  <span>{step.timeEstimate}</span>
                </div>
              </div>

              {/* Tasks Checklist */}
              <div className="space-y-2 mt-4 pl-1">
                {step.tasks.map((task, idx) => {
                  const taskId = `step-${step.step}-task-${idx}`;
                  const isDone = !!completedTasks[taskId];

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleTask(taskId)}
                      className={`flex items-start gap-2.5 p-2 rounded-lg cursor-pointer transition-colors text-xs select-none ${
                        isDone
                          ? 'bg-emerald-500/5 text-slate-400 line-through'
                          : 'hover:bg-slate-850 text-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        className="mt-0.5 text-slate-400 hover:text-sky-400 transition-colors shrink-0"
                      >
                        {isDone ? (
                          <CheckSquare className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <Square className="w-4 h-4" />
                        )}
                      </button>
                      <span className="leading-relaxed">{task}</span>
                    </div>
                  );
                })}
              </div>

              {/* Practical Tip */}
              <div className="mt-3 pt-3 border-t border-slate-800/80 flex items-start gap-2 text-xs text-slate-400">
                <Lightbulb className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">
                  <strong className="text-slate-300">Совет эксперта:</strong> {step.tips}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
