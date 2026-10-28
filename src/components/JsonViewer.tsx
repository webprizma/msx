import React, { useState } from 'react';
import { MsxPlaylist } from '../types/msx';
import { Copy, Check, Download, Upload, CheckCircle2, AlertTriangle, FileCode } from 'lucide-react';

interface JsonViewerProps {
  playlist: MsxPlaylist;
  onImportPlaylist: (imported: MsxPlaylist) => void;
}

export const JsonViewer: React.FC<JsonViewerProps> = ({ playlist, onImportPlaylist }) => {
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const formattedJson = JSON.stringify(playlist, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(formattedJson);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([formattedJson], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'start.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    try {
      const parsed = JSON.parse(importText);
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('JSON должен быть объектом');
      }
      if (!Array.isArray(parsed.menu) && !parsed.pages) {
        throw new Error('В файле отсутствует поле "menu" или "pages", требуемые MSX');
      }
      onImportPlaylist(parsed);
      setShowImportModal(false);
      setImportText('');
    } catch (err: any) {
      setValidationError(err.message || 'Ошибка парсинга JSON');
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Banner */}
      <div className="p-5 rounded-2xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <FileCode className="w-5 h-5 text-sky-400" />
            <span>Готовый файл start.json для Media Station X</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Этот JSON генерируется в реальном времени из ваших настроек. Сохраните его и положите на ваш веб-сервер.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Импорт JSON</span>
          </button>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Скопировано!' : 'Скопировать'}</span>
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-semibold transition-colors cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Скачать start.json</span>
          </button>
        </div>
      </div>

      {/* JSON Code Area */}
      <div className="relative rounded-2xl border border-slate-800 bg-slate-950 overflow-hidden shadow-2xl">
        <div className="px-4 py-2 bg-slate-900/80 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
          <span>start.json (Media Station X Protocol v1.0)</span>
          <span className="text-emerald-400 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Синтаксис валиден</span>
          </span>
        </div>
        <pre className="p-5 text-xs font-mono text-sky-300/90 leading-relaxed overflow-x-auto max-h-[600px]">
          {formattedJson}
        </pre>
      </div>

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-xl p-5 shadow-2xl flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">
                Импорт существующего плейлиста MSX
              </h3>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Вставьте содержимое любого файла `start.json` или `msx.json`, чтобы открыть его в визуальном конструкторе.
            </p>

            <form onSubmit={handleImportSubmit} className="flex flex-col gap-3">
              <textarea
                rows={8}
                required
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder='{"name": "...", "menu": [...]}'
                className="w-full p-3 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white focus:outline-none focus:border-sky-500"
              />

              {validationError && (
                <div className="flex items-center gap-2 p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{validationError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg cursor-pointer"
                >
                  Загрузить в конструктор
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
