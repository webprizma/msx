import React, { useState } from 'react';
import { SERVER_TEMPLATES, ServerTemplate } from '../data/guides';
import { Copy, Check, Download, Server, Terminal, Cloud, CheckCircle2, ChevronRight } from 'lucide-react';

export const HostingTemplates: React.FC = () => {
  const [selectedTemplate, setSelectedTemplate] = useState<ServerTemplate>(SERVER_TEMPLATES[0]);
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(selectedTemplate.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    const blob = new Blob([selectedTemplate.code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = selectedTemplate.filename.split(' ')[0] || 'msx_server.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800">
        <h2 className="text-base font-bold text-white tracking-tight">
          Готовые шаблоны и код домашнего сервера для MSX
        </h2>
        <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
          Выберите подходящую для ваших условий платформу: от абсолютно бесплатного облачного хостинга на GitHub Pages до локального сервера на Node.js, Python или Docker-контейнера на домашнем NAS.
        </p>
      </div>

      {/* Template Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {SERVER_TEMPLATES.map((tmpl) => (
          <button
            key={tmpl.id}
            onClick={() => setSelectedTemplate(tmpl)}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
              selectedTemplate.id === tmpl.id
                ? 'bg-slate-850 border-sky-500 ring-1 ring-sky-500 shadow-lg shadow-sky-500/10'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div>
              <div className="flex items-center justify-between text-[11px] text-slate-400 mb-2">
                <span className="font-semibold text-sky-400">{tmpl.platform}</span>
                <span className="text-slate-500">{tmpl.difficulty}</span>
              </div>
              <h3 className="text-xs font-bold text-white mb-1.5 leading-snug">
                {tmpl.name}
              </h3>
              <p className="text-[11px] text-slate-400 line-clamp-2">
                {tmpl.description}
              </p>
            </div>

            <div className="mt-3 pt-2 border-t border-slate-800/80 flex items-center text-[11px] font-medium text-slate-400">
              <span className={selectedTemplate.id === tmpl.id ? 'text-sky-400' : ''}>
                {selectedTemplate.id === tmpl.id ? 'Выбран для просмотра' : 'Выбрать шаблон'}
              </span>
              <ChevronRight className="w-3.5 h-3.5 ml-auto" />
            </div>
          </button>
        ))}
      </div>

      {/* Selected Template Details View */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Code Box */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-sky-400" />
              <span className="text-xs font-mono font-bold text-slate-300">
                {selectedTemplate.filename}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleCopyCode}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Скопировано!' : 'Скопировать код'}</span>
              </button>
              <button
                onClick={handleDownloadFile}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
                title="Скачать файл скрипта"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Скачать файл</span>
              </button>
            </div>
          </div>

          <div className="relative rounded-xl border border-slate-800 bg-slate-950 overflow-hidden shadow-inner">
            <pre className="p-4 text-xs font-mono text-slate-300 overflow-x-auto leading-relaxed max-h-[480px]">
              {selectedTemplate.code}
            </pre>
          </div>
        </div>

        {/* Right: Setup instructions & Pros/Cons */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          {/* Instructions */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
              Пошаговая инструкция по запуску
            </h3>
            <ol className="space-y-2.5 text-xs text-slate-300">
              {selectedTemplate.instructions.map((step, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-slate-800 text-sky-400 font-bold text-[11px] flex items-center justify-center shrink-0 mt-0.5 border border-slate-700">
                    {idx + 1}
                  </span>
                  <span className="leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Pros & Cons */}
          <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3 text-xs">
            <div>
              <h4 className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider mb-1.5">
                Преимущества:
              </h4>
              <ul className="space-y-1 text-slate-300">
                {selectedTemplate.pros.map((pro, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>{pro}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="pt-2 border-t border-slate-800">
              <h4 className="text-[11px] font-bold text-amber-400 uppercase tracking-wider mb-1.5">
                Особенности и нюансы:
              </h4>
              <ul className="space-y-1 text-slate-400">
                {selectedTemplate.cons.map((con, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-amber-400 leading-none mt-1">·</span>
                    <span>{con}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
