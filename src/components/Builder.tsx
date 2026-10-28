import React, { useState } from 'react';
import { MsxPlaylist, MsxItem, MsxMenuItem, PresetApp } from '../types/msx';
import { POPULAR_PRESETS } from '../data/presets';
import {
  Plus,
  Trash2,
  Edit2,
  Save,
  RotateCcw,
  Sparkles,
  Layers,
  Settings,
  Grid,
  ExternalLink,
  Check,
  AlertCircle
} from 'lucide-react';

interface BuilderProps {
  playlist: MsxPlaylist;
  onUpdatePlaylist: (newPlaylist: MsxPlaylist) => void;
  onSaveToServer: () => Promise<void>;
  isSaving: boolean;
  saveMessage: string | null;
}

export const Builder: React.FC<BuilderProps> = ({
  playlist,
  onUpdatePlaylist,
  onSaveToServer,
  isSaving,
  saveMessage
}) => {
  const [activeMenuIndex, setActiveMenuIndex] = useState(0);
  const [editingItem, setEditingItem] = useState<MsxItem | null>(null);
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [showPresetModal, setShowPresetModal] = useState(false);
  const [showPortalSettings, setShowPortalSettings] = useState(false);

  const currentMenu = playlist.menu[activeMenuIndex] || playlist.menu[0];
  const items = currentMenu?.data?.pages?.[0]?.items || [];

  // Form state for editing or creating an item
  const [formData, setFormData] = useState<Partial<MsxItem>>({
    label: '',
    action: 'link:http://',
    badge: '',
    icon: '',
    layout: '0,0,3,3',
    description: ''
  });

  const handleEditClick = (item: MsxItem) => {
    setEditingItem(item);
    setFormData(item);
    setIsAddingCustom(false);
  };

  const handleAddNewCustom = () => {
    // Calculate next available grid coordinates
    const count = items.length;
    const col = (count % 4) * 3;
    const row = Math.floor(count / 4) * 3;
    const defaultLayout = `${col},${row},3,3`;

    setFormData({
      label: 'Новое приложение',
      action: 'link:https://',
      badge: 'Новинка',
      icon: '',
      layout: defaultLayout,
      description: 'Пользовательское веб-приложение'
    });
    setEditingItem(null);
    setIsAddingCustom(true);
  };

  const handleSaveItemForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.label || !formData.action) return;

    const newItems = [...items];
    if (editingItem) {
      // Update existing
      const idx = newItems.findIndex(i => i.id === editingItem.id);
      if (idx !== -1) {
        newItems[idx] = {
          ...editingItem,
          ...(formData as MsxItem)
        };
      }
    } else {
      // Add new
      const newItem: MsxItem = {
        id: `item-${Date.now()}`,
        type: 'button',
        layout: formData.layout || '0,0,3,3',
        label: formData.label,
        action: formData.action,
        badge: formData.badge,
        icon: formData.icon,
        description: formData.description
      };
      newItems.push(newItem);
    }

    // Update playlist tree
    const updatedMenu = [...playlist.menu];
    updatedMenu[activeMenuIndex] = {
      ...currentMenu,
      data: {
        pages: [{ items: newItems }]
      }
    };

    onUpdatePlaylist({
      ...playlist,
      menu: updatedMenu
    });

    setEditingItem(null);
    setIsAddingCustom(false);
  };

  const handleDeleteItem = (itemId: string) => {
    const newItems = items.filter(i => i.id !== itemId);
    const updatedMenu = [...playlist.menu];
    updatedMenu[activeMenuIndex] = {
      ...currentMenu,
      data: {
        pages: [{ items: newItems }]
      }
    };
    onUpdatePlaylist({
      ...playlist,
      menu: updatedMenu
    });
  };

  const handleAddPreset = (preset: PresetApp) => {
    const count = items.length;
    const col = (count % 4) * 3;
    const row = Math.floor(count / 4) * 3;
    const autoLayout = `${col},${row},3,3`;

    const newItem: MsxItem = {
      id: `item-${Date.now()}-${preset.id}`,
      type: 'button',
      layout: autoLayout,
      label: preset.name,
      action: preset.action,
      badge: preset.badge,
      icon: preset.icon,
      description: preset.description
    };

    const newItems = [...items, newItem];
    const updatedMenu = [...playlist.menu];
    updatedMenu[activeMenuIndex] = {
      ...currentMenu,
      data: {
        pages: [{ items: newItems }]
      }
    };

    onUpdatePlaylist({
      ...playlist,
      menu: updatedMenu
    });

    setShowPresetModal(false);
  };

  // Add new category/menu tab
  const handleAddCategory = () => {
    const title = prompt('Введите название новой категории:', 'Новая категория');
    if (!title) return;

    const newCategory: MsxMenuItem = {
      id: `menu-${Date.now()}`,
      icon: 'folder',
      label: title,
      data: {
        pages: [{ items: [] }]
      }
    };

    onUpdatePlaylist({
      ...playlist,
      menu: [...playlist.menu, newCategory]
    });
    setActiveMenuIndex(playlist.menu.length);
  };

  // Delete category
  const handleDeleteCategory = (idx: number) => {
    if (playlist.menu.length <= 1) {
      alert('Должна остаться хотя бы одна категория!');
      return;
    }
    if (!confirm(`Удалить категорию "${playlist.menu[idx].label}"?`)) return;

    const newMenu = playlist.menu.filter((_, i) => i !== idx);
    onUpdatePlaylist({
      ...playlist,
      menu: newMenu
    });
    setActiveMenuIndex(0);
  };

  // Auto-align 12-column grid coordinates
  const handleAutoAlignGrid = () => {
    const newItems = items.map((item, idx) => {
      const col = (idx % 4) * 3;
      const row = Math.floor(idx / 4) * 3;
      return {
        ...item,
        layout: `${col},${row},3,3`
      };
    });

    const updatedMenu = [...playlist.menu];
    updatedMenu[activeMenuIndex] = {
      ...currentMenu,
      data: {
        pages: [{ items: newItems }]
      }
    };

    onUpdatePlaylist({
      ...playlist,
      menu: updatedMenu
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight">
            Визуальный конструктор меню MSX
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Настройте разделы, добавляйте веб-приложения и выстраивайте сетку для Smart TV
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800">
            <span className={`w-2 h-2 rounded-full ${isSaving ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
            <span>{isSaving ? 'Сохранение на сервер...' : 'Автосохранение активно'}</span>
          </div>

          <button
            onClick={() => setShowPortalSettings(!showPortalSettings)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            <Settings className="w-4 h-4" />
            <span>Настройки темы</span>
          </button>

          <button
            onClick={onSaveToServer}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer border border-slate-700 disabled:opacity-50"
            title="Принудительно отправить текущее состояние на сервер"
          >
            <Save className="w-4 h-4 text-sky-400" />
            <span>Синхронизировать</span>
          </button>
        </div>
      </div>

      {saveMessage && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs animate-in fade-in">
          <Check className="w-4 h-4 shrink-0" />
          <span>{saveMessage}</span>
        </div>
      )}

      {/* Portal Global Settings Drawer (Collapsible) */}
      {showPortalSettings && (
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Название портала (MSX Name)
            </label>
            <input
              type="text"
              value={playlist.name}
              onChange={(e) => onUpdatePlaylist({ ...playlist, name: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Подзаголовок (Headline)
            </label>
            <input
              type="text"
              value={playlist.headline || ''}
              onChange={(e) => onUpdatePlaylist({ ...playlist, headline: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
              placeholder="Домашний кинотеатр"
            />
          </div>

          <div>
            <label className="block text-slate-400 font-medium mb-1">
              Ссылка на фоновое изображение (URL)
            </label>
            <input
              type="text"
              value={playlist.background || ''}
              onChange={(e) => onUpdatePlaylist({ ...playlist, background: e.target.value })}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
              placeholder="https://..."
            />
          </div>
        </div>
      )}

      {/* Category Tabs Strip */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-4">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {playlist.menu.map((menuItem, idx) => (
            <div key={menuItem.id || `menu-${idx}-${menuItem.label}`} className="flex items-center gap-1">
              <button
                onClick={() => {
                  setActiveMenuIndex(idx);
                  setEditingItem(null);
                  setIsAddingCustom(false);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer flex items-center gap-2 ${
                  activeMenuIndex === idx
                    ? 'bg-slate-800 text-sky-400 border border-sky-500/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-850'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{menuItem.label}</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-700/60 text-slate-300">
                  {menuItem.data?.pages?.[0]?.items?.length || 0}
                </span>
              </button>

              {playlist.menu.length > 1 && (
                <button
                  onClick={() => handleDeleteCategory(idx)}
                  className="p-1 text-slate-600 hover:text-rose-400 transition-colors cursor-pointer"
                  title="Удалить категорию"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}

          <button
            onClick={handleAddCategory}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 text-xs transition-colors cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Категория</span>
          </button>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleAutoAlignGrid}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors cursor-pointer"
            title="Автоматически выровнять плитки по сетке 4x3"
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Выровнять сетку</span>
          </button>
        </div>
      </div>

      {/* Main Items Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Apps Grid */}
        <div className="lg:col-span-8 flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Приложения в разделе «{currentMenu?.label}»
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPresetModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 text-xs font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Выбрать из готовых (Lampa, VoKino...)</span>
              </button>
              <button
                onClick={handleAddNewCustom}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Своя ссылка</span>
              </button>
            </div>
          </div>

          {/* Cards List */}
          {items.length === 0 ? (
            <div className="p-8 rounded-xl border border-dashed border-slate-800 text-center flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-500 mb-3">
                <Grid className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-300 mb-1">
                В этой категории пока пусто
              </p>
              <p className="text-xs text-slate-500 mb-4 max-w-sm">
                Добавьте приложения из готового каталога популярных сервисов для Smart TV или укажите свои веб-адреса.
              </p>
              <button
                onClick={() => setShowPresetModal(true)}
                className="px-4 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer"
              >
                Открыть каталог пресетов
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {items.map((item, idx) => (
                <div
                  key={item.id || `item-${idx}-${item.label || 'app'}`}
                  className={`p-3.5 rounded-xl border transition-all flex items-start justify-between gap-3 ${
                    editingItem?.id === item.id
                      ? 'bg-slate-850 border-sky-500 ring-1 ring-sky-500'
                      : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center p-1.5 shrink-0 overflow-hidden">
                      {item.icon ? (
                        <img
                          src={item.icon}
                          alt={item.label}
                          className="w-full h-full object-contain"
                        />
                      ) : (
                        <Sparkles className="w-5 h-5 text-sky-400" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold text-white truncate">
                          {item.label}
                        </h4>
                        {item.badge && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700 truncate">
                            {item.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-slate-400 truncate mt-0.5">
                        {item.action}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                        <span>Сетка: {item.layout}</span>
                        {item.description && (
                          <>
                            <span>·</span>
                            <span className="truncate">{item.description}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => handleEditClick(item)}
                      className="p-1.5 text-slate-400 hover:text-sky-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="Редактировать"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded transition-colors cursor-pointer"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Column: Edit / Add Form */}
        <div className="lg:col-span-4">
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 sticky top-24">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">
              {editingItem ? 'Редактирование элемента' : isAddingCustom ? 'Добавление приложения' : 'Свойства элемента'}
            </h3>

            {!editingItem && !isAddingCustom ? (
              <div className="text-xs text-slate-400 py-6 text-center">
                Выберите плитку слева для редактирования или нажмите «Своя ссылка» / «Выбрать из готовых».
              </div>
            ) : (
              <form onSubmit={handleSaveItemForm} className="flex flex-col gap-3 text-xs">
                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    Название на экране
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.label || ''}
                    onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
                    placeholder="Например: Lampa TV"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    Действие при клике (MSX Action)
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.action || ''}
                    onChange={(e) => setFormData({ ...formData, action: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-sky-500"
                    placeholder="link:https://lampa.mx"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    Примеры: <code className="text-slate-400">link:http://lampa.mx</code>, <code className="text-slate-400">execute:info:Привет</code>
                  </p>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    Бейдж / Метка (необязательно)
                  </label>
                  <input
                    type="text"
                    value={formData.badge || ''}
                    onChange={(e) => setFormData({ ...formData, badge: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
                    placeholder="HD, 4K, Кино, Новинка"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    URL иконки или логотипа
                  </label>
                  <input
                    type="text"
                    value={formData.icon || ''}
                    onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500"
                    placeholder="https://.../icon.png"
                  />
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    Координаты сетки (layout: X, Y, W, H)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={formData.layout || '0,0,3,3'}
                      onChange={(e) => setFormData({ ...formData, layout: e.target.value })}
                      className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white font-mono focus:outline-none focus:border-sky-500"
                    />
                  </div>
                  <div className="flex gap-1.5 mt-1.5">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, layout: '0,0,3,3' })}
                      className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      3x3 (4 в ряд)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, layout: '0,0,4,4' })}
                      className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      4x4 (3 в ряд)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, layout: '0,0,6,3' })}
                      className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 hover:bg-slate-700 cursor-pointer"
                    >
                      6x3 (широкая)
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-400 font-medium mb-1">
                    Краткое описание
                  </label>
                  <textarea
                    rows={2}
                    value={formData.description || ''}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-sky-500 resize-none"
                    placeholder="Описание для пульта..."
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    className="flex-1 py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    {editingItem ? 'Применить изменения' : 'Добавить в меню'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingItem(null);
                      setIsAddingCustom(false);
                    }}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors cursor-pointer"
                  >
                    Отмена
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* Preset Library Modal */}
      {showPresetModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white">
                  Каталог популярных приложений для Smart TV
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Нажмите на любое приложение, чтобы мгновенно добавить его в текущую категорию
                </p>
              </div>
              <button
                onClick={() => setShowPresetModal(false)}
                className="text-slate-400 hover:text-white p-1 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
              {POPULAR_PRESETS.map((preset) => (
                <div
                  key={preset.id}
                  onClick={() => handleAddPreset(preset)}
                  className="p-3.5 rounded-xl border border-slate-800 hover:border-sky-500/50 bg-slate-950 hover:bg-slate-850 transition-all cursor-pointer flex flex-col justify-between group"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 p-2 shrink-0 flex items-center justify-center">
                      <img
                        src={preset.icon}
                        alt={preset.name}
                        className="w-full h-full object-contain"
                      />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-white group-hover:text-sky-400 transition-colors">
                          {preset.name}
                        </h4>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                          {preset.category}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                        {preset.description}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 pt-2.5 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="truncate max-w-[200px] font-mono text-slate-400">
                      {preset.action}
                    </span>
                    <span className="text-sky-400 font-medium group-hover:underline">
                      + Добавить
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950 flex justify-end">
              <button
                onClick={() => setShowPresetModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-medium cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
