import React, { useState } from 'react';
import { PITFALLS_LIST } from '../data/guides';
import {
  AlertTriangle,
  ShieldAlert,
  Info,
  CheckCircle2,
  Copy,
  Check,
  Search,
  ExternalLink,
  Tv
} from 'lucide-react';

export const PitfallsGuide: React.FC = () => {
  const [filterSeverity, setFilterSeverity] = useState<string>('all');
  const [testUrl, setTestUrl] = useState('');
  const [diagnosticResult, setDiagnosticResult] = useState<any | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filteredPitfalls = PITFALLS_LIST.filter((p) => {
    if (filterSeverity === 'all') return true;
    return p.severity === filterSeverity;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const runUrlDiagnostics = (e: React.FormEvent) => {
    e.preventDefault();
    if (!testUrl.trim()) return;

    const trimmed = testUrl.trim();
    const isHttps = trimmed.startsWith('https://');
    const isHttp = trimmed.startsWith('http://');
    const isLocalIp = /^(https?:\/\/)?(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|127\.0\.0\.1|localhost)/i.test(trimmed);
    const endsWithJson = trimmed.includes('.json') || trimmed.includes('/json') || trimmed.includes('msx');
    const isPortSpecified = /:\d{2,5}/.test(trimmed);

    const issues: string[] = [];
    const recommendations: string[] = [];
    let status: 'ok' | 'warning' | 'error' = 'ok';

    if (isHttp && isLocalIp) {
      status = 'warning';
      issues.push('Протокол HTTP на локальном IP-адресе (Mixed Content риск).');
      recommendations.push(
        'Если вы используете Media Station X из официального магазина LG Content Store или Samsung Apps, приложение загружается по HTTPS. На моделях ТВ 2021-2026 годов браузер ТВ заблокирует запрос к локальному HTTP серверу. Рекомендуем выложить start.json на GitHub Pages (HTTPS) или использовать Cloudflare Tunnel.'
      );
    }

    if (!isHttps && !isHttp) {
      status = 'error';
      issues.push('URL не содержит протокола http:// или https://.');
      recommendations.push('Обязательно укажите протокол, например https://...');
    }

    if (isHttps && isLocalIp) {
      status = 'warning';
      issues.push('HTTPS на локальном IP (риск ошибки самоподписанного сертификата).');
      recommendations.push(
        'Телевизоры не поддерживают самоподписанные SSL-сертификаты! Используйте бесплатный сервис DuckDNS + Let\'s Encrypt или GitHub Pages.'
      );
    }

    if (!endsWithJson) {
      issues.push('В ссылке не указано расширение .json.');
      recommendations.push(
        'Убедитесь, что сервер возвращает заголовок Content-Type: application/json; charset=utf-8, иначе MSX может не распознать ответ.'
      );
    }

    if (issues.length === 0) {
      recommendations.push('URL выглядит отлично! Убедитесь, что сервер настроен на отдачу заголовка Access-Control-Allow-Origin: *.');
    }

    setDiagnosticResult({
      url: trimmed,
      status,
      issues,
      recommendations
    });
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Overview Banner */}
      <div className="p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 border border-slate-800">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white tracking-tight">
              Главные подводные камни при создании своего сервера MSX
            </h2>
            <p className="text-xs text-slate-300 mt-1 leading-relaxed max-w-3xl">
              Написать код сервера или создать JSON-файл легко. Но 90% новичков сталкиваются с тем, что на компьютере в браузере всё открывается идеально, а телевизор выдает ошибку «Connection failed» или «Validation error». Ниже детально разобраны все специфические ограничения Smart TV (Samsung Tizen, LG webOS, Android TV).
            </p>
          </div>
        </div>
      </div>

      {/* Interactive URL Diagnostic Inspector */}
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-1">
          <Tv className="w-4 h-4 text-sky-400" />
          <span>Экспресс-диагностика адреса сервера перед вводом в ТВ</span>
        </h3>
        <p className="text-xs text-slate-400 mb-4">
          Вставьте ссылку, которую планируете ввести в поле «Параметр запуска» на телевизоре, и анализатор проверит её на совместимость со Smart TV:
        </p>

        <form onSubmit={runUrlDiagnostics} className="flex gap-2">
          <input
            type="text"
            value={testUrl}
            onChange={(e) => setTestUrl(e.target.value)}
            placeholder="Например: http://192.168.1.45:8080/start.json или https://kulagin.github.io/msx/start.json"
            className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white font-mono focus:outline-none focus:border-sky-500"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer shrink-0"
          >
            Проверить совместимость
          </button>
        </form>

        {diagnosticResult && (
          <div className={`mt-4 p-4 rounded-xl border text-xs animate-in fade-in ${
            diagnosticResult.status === 'ok'
              ? 'bg-emerald-500/10 border-emerald-500/30'
              : diagnosticResult.status === 'warning'
              ? 'bg-amber-500/10 border-amber-500/30'
              : 'bg-rose-500/10 border-rose-500/30'
          }`}>
            <div className="flex items-center gap-2 font-bold mb-2">
              {diagnosticResult.status === 'ok' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">Формат адреса корректен</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-400">Обнаружены потенциальные проблемы для Smart TV:</span>
                </>
              )}
            </div>

            {diagnosticResult.issues.length > 0 && (
              <ul className="list-disc list-inside space-y-1 text-slate-300 mb-3">
                {diagnosticResult.issues.map((issue: string, i: number) => (
                  <li key={i}>{issue}</li>
                ))}
              </ul>
            )}

            <div className="text-slate-200 bg-slate-950/60 p-3 rounded-lg border border-white/5 space-y-1">
              <span className="font-semibold block text-slate-300">Рекомендация:</span>
              {diagnosticResult.recommendations.map((rec: string, i: number) => (
                <p key={i} className="leading-relaxed">{rec}</p>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterSeverity('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterSeverity === 'all'
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Все нюансы ({PITFALLS_LIST.length})
          </button>
          <button
            onClick={() => setFilterSeverity('critical')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterSeverity === 'critical'
                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Критические (Блокируют запуск)
          </button>
          <button
            onClick={() => setFilterSeverity('warning')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterSeverity === 'warning'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Важные предупреждения
          </button>
          <button
            onClick={() => setFilterSeverity('info')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              filterSeverity === 'info'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Тонкости и эргономика
          </button>
        </div>
      </div>

      {/* Pitfall Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredPitfalls.map((pitfall) => (
          <div
            key={pitfall.id}
            className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-4"
          >
            <div>
              <div className="flex items-start justify-between gap-3 mb-2">
                <h3 className="text-sm font-bold text-white tracking-tight">
                  {pitfall.title}
                </h3>
                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase tracking-wider shrink-0 ${
                  pitfall.severity === 'critical'
                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                    : pitfall.severity === 'warning'
                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                    : 'bg-sky-500/10 text-sky-400 border border-sky-500/30'
                }`}>
                  {pitfall.severity === 'critical' ? 'Критично' : pitfall.severity === 'warning' ? 'Важно' : 'Инфо'}
                </span>
              </div>

              {/* Affected TVs */}
              <div className="text-[11px] text-slate-400 mb-3 flex items-center gap-1.5">
                <span className="text-slate-500">Затрагивает:</span>
                <span className="text-slate-300 font-medium">{pitfall.tvImpact}</span>
              </div>

              {/* Problem statement */}
              <div className="text-xs text-slate-300 leading-relaxed mb-3">
                <strong className="text-slate-200 block mb-0.5">В чем проблема:</strong>
                {pitfall.problem}
              </div>

              {/* Solution statement */}
              <div className="text-xs text-slate-300 leading-relaxed bg-slate-950/70 p-3 rounded-lg border border-slate-800/80">
                <strong className="text-sky-400 block mb-0.5">Как решить:</strong>
                {pitfall.solution}
              </div>

              {pitfall.sampleCode && (
                <div className="mt-3 relative">
                  <pre className="p-3 bg-black/60 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto border border-white/5">
                    {pitfall.sampleCode}
                  </pre>
                  <button
                    onClick={() => handleCopy(pitfall.id, pitfall.sampleCode!)}
                    className="absolute top-2 right-2 p-1.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 cursor-pointer"
                    title="Скопировать пример"
                  >
                    {copiedId === pitfall.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
