import {
  AlertTriangle,
  Archive,
  BookCopy,
  Check,
  Copy,
  Database,
  Pencil,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { WorldSaveSummary } from '../persistence/storage';
import { MAX_LABEL_LENGTH, MAX_WORLD_SLOTS } from '../persistence/storage';
import '../styles/world-collection.css';

type MaybePromise = void | Promise<void>;

export interface WorldCollectionPanelProps {
  open: boolean;
  saves: WorldSaveSummary[];
  currentSlot?: string;
  busy?: boolean;
  canSaveCurrent?: boolean;
  onLoad: (slot: string) => MaybePromise;
  onDelete: (slot: string) => MaybePromise;
  onRename: (slot: string, label: string) => MaybePromise;
  onDuplicate: (slot: string) => MaybePromise;
  onSaveCurrent: (label: string) => MaybePromise;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
}

type EditingState = { slot: string; label: string } | null;

function formatSavedAt(savedAt: string | null): string {
  if (!savedAt) return '时间未知';
  const time = Date.parse(savedAt);
  if (!Number.isFinite(time) || time <= 0) return '旧版存档';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(time));
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : '本次存档操作没有完成。';
}

export function WorldCollectionPanel({
  open,
  saves,
  currentSlot,
  busy = false,
  canSaveCurrent = true,
  onLoad,
  onDelete,
  onRename,
  onDuplicate,
  onSaveCurrent,
  onClose,
  returnFocusTo,
}: WorldCollectionPanelProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const onCloseRef = useRef(onClose);
  const modeRef = useRef<{ editing: EditingState; deleting: string | null }>({ editing: null, deleting: null });
  const [newLabel, setNewLabel] = useState('');
  const [editing, setEditing] = useState<EditingState>(null);
  const [deletingSlot, setDeletingSlot] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  onCloseRef.current = onClose;
  modeRef.current = { editing, deleting: deletingSlot };

  const orderedSaves = useMemo(() => [
    ...saves.filter((save) => save.isAutosave),
    ...saves.filter((save) => !save.isAutosave),
  ], [saves]);
  const namedCount = saves.filter((save) => !save.isAutosave).length;
  const unavailable = busy || pendingAction !== null;

  useEffect(() => {
    if (!open) return;
    setEditing(null);
    setDeletingSlot(null);
    setPendingAction(null);
    setActionError(null);
  }, [open]);

  useEffect(() => {
    if (!editing) return;
    const frame = requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing?.slot]);

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = returnFocusTo ?? (document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null);
    const frame = requestAnimationFrame(() => closeRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (modeRef.current.deleting) setDeletingSlot(null);
        else if (modeRef.current.editing) setEditing(null);
        else onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      queueMicrotask(() => previouslyFocused?.focus({ preventScroll: true }));
    };
  }, [open, returnFocusTo]);

  if (!open) return null;

  const perform = async (key: string, action: () => MaybePromise, after?: () => void) => {
    if (unavailable) return;
    setPendingAction(key);
    setActionError(null);
    try {
      await action();
      after?.();
    } catch (error) {
      setActionError(errorText(error));
    } finally {
      setPendingAction(null);
    }
  };

  const saveCurrent = () => {
    const label = newLabel.trim();
    if (!canSaveCurrent || !label || namedCount >= MAX_WORLD_SLOTS) return;
    void perform('save-current', () => onSaveCurrent(label), () => setNewLabel(''));
  };

  const submitRename = (slot: string) => {
    const label = editing?.slot === slot ? editing.label.trim() : '';
    if (!label) return;
    void perform(`rename:${slot}`, () => onRename(slot, label), () => setEditing(null));
  };

  return (
    <div className="world-collection-layer">
      <button
        type="button"
        className="world-collection-layer__backdrop"
        tabIndex={-1}
        aria-label="关闭世界收藏"
        onClick={onClose}
      />
      <section
        ref={dialogRef}
        className="world-collection"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={unavailable}
      >
        <header className="world-collection__header">
          <span className="world-collection__seal" aria-hidden="true"><Archive size={20} /></span>
          <div>
            <span>本机世界 · 分支收藏</span>
            <h2 id={titleId}>世界收藏</h2>
            <p id={descriptionId}>自动续写保留最近进度；收藏世界可独立命名、读取与复制。</p>
          </div>
          <div className="world-collection__count" aria-label={`已收藏 ${namedCount} 个，最多 ${MAX_WORLD_SLOTS} 个`}>
            <strong>{namedCount}</strong><span>/ {MAX_WORLD_SLOTS}</span>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭世界收藏">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <form
          className="world-collection__save-current"
          onSubmit={(event) => {
            event.preventDefault();
            saveCurrent();
          }}
        >
          <Save size={18} aria-hidden="true" />
          <label htmlFor={`${titleId}-new-label`}>
            <strong>收藏当前世界</strong>
            <span>{!canSaveCurrent
              ? '请先开启或读取一个世界。'
              : namedCount >= MAX_WORLD_SLOTS
                ? '收藏已满，请先删除一个旧世界。'
                : '保存为新的独立分支，不影响自动续写。'}</span>
          </label>
          <input
            ref={createInputRef}
            id={`${titleId}-new-label`}
            value={newLabel}
            onChange={(event) => setNewLabel(event.target.value)}
            placeholder="例如：北海兴亡录"
            maxLength={MAX_LABEL_LENGTH}
            disabled={unavailable || !canSaveCurrent || namedCount >= MAX_WORLD_SLOTS}
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={unavailable || !canSaveCurrent || namedCount >= MAX_WORLD_SLOTS || !newLabel.trim()}
          >
            {pendingAction === 'save-current' ? '落笔中…' : '存入收藏'}
          </button>
        </form>

        {actionError ? <p className="world-collection__error" role="alert"><AlertTriangle size={14} aria-hidden="true" />{actionError}</p> : null}

        <div className="world-collection__body">
          <div className="world-collection__columns" aria-hidden="true">
            <span>世界与进度</span><span>保存时间</span><span>体积</span><span>操作</span>
          </div>

          {orderedSaves.length ? (
            <ol className="world-collection__list" aria-label="本机世界存档">
              {orderedSaves.map((save) => {
                const isCurrent = currentSlot === save.slot;
                const isCorrupt = save.status === 'corrupt';
                const isIncompatible = save.status === 'incompatible';
                const isReadable = save.status === 'ready';
                const isEditing = editing?.slot === save.slot;
                const isDeleting = deletingSlot === save.slot;
                const rowPending = pendingAction?.endsWith(`:${save.slot}`) ?? false;
                return (
                  <li
                    key={save.slot}
                    className="world-collection__row"
                    data-current={isCurrent || undefined}
                    data-corrupt={isCorrupt || undefined}
                    data-incompatible={isIncompatible || undefined}
                  >
                    <div className="world-collection__identity">
                      <span className="world-collection__mark" aria-hidden="true">
                        {isCorrupt || isIncompatible ? <AlertTriangle size={16} /> : save.isAutosave ? <Database size={16} /> : <BookCopy size={16} />}
                      </span>
                      <div>
                        {isEditing ? (
                          <form
                            className="world-collection__rename"
                            onSubmit={(event) => {
                              event.preventDefault();
                              submitRename(save.slot);
                            }}
                          >
                            <label className="sr-only" htmlFor={`${titleId}-rename-${save.slot}`}>修改{save.label}的名称</label>
                            <input
                              ref={renameInputRef}
                              id={`${titleId}-rename-${save.slot}`}
                              value={editing.label}
                              maxLength={MAX_LABEL_LENGTH}
                              disabled={unavailable}
                              onChange={(event) => setEditing({ slot: save.slot, label: event.target.value })}
                            />
                            <button type="submit" disabled={unavailable || !editing.label.trim()} aria-label="确认改名"><Check size={15} aria-hidden="true" /></button>
                            <button type="button" disabled={unavailable} onClick={() => setEditing(null)} aria-label="取消改名"><X size={15} aria-hidden="true" /></button>
                          </form>
                        ) : (
                          <div className="world-collection__name">
                            <strong>{save.label}</strong>
                            {save.isAutosave ? <span>自动</span> : null}
                            {isCurrent ? <span>当前</span> : null}
                            {isCorrupt ? <span>损坏</span> : null}
                            {isIncompatible ? <span>地图未安装</span> : null}
                          </div>
                        )}
                        {isCorrupt ? (
                          <p>{save.error ?? '此槽位无法解析，但其他收藏不受影响。'}</p>
                        ) : isIncompatible ? (
                          <p>
                            <span>{save.error}</span>
                            <span>可先复制留底，补回地图后即可读取。</span>
                          </p>
                        ) : (
                          <p>
                            <span>{save.mapName} · 第 {save.mapRevision} 版</span>
                            <span title={save.seed ?? undefined}>种子 {save.seed}</span>
                            <span>第 {save.year} 年 · {save.season}</span>
                            <span>回合 {save.turn}</span>
                            <code title={save.hash ?? undefined}>{save.hash?.slice(0, 12)}</code>
                          </p>
                        )}
                      </div>
                    </div>

                    <time dateTime={save.savedAt ?? undefined}>{formatSavedAt(save.savedAt)}</time>
                    <span className="world-collection__size">{formatBytes(save.payloadBytes)}</span>

                    <div className="world-collection__actions" aria-label={`${save.label}存档操作`}>
                      {isReadable ? (
                        <button
                          type="button"
                          disabled={unavailable || isCurrent}
                          onClick={() => void perform(`load:${save.slot}`, () => onLoad(save.slot))}
                        >
                          {isCurrent ? '当前' : pendingAction === `load:${save.slot}` ? '读取中…' : '读取'}
                        </button>
                      ) : null}
                      {!save.isAutosave && !isCorrupt ? (
                        <button
                          type="button"
                          className="world-collection__icon-action"
                          disabled={unavailable}
                          onClick={() => {
                            setDeletingSlot(null);
                            setEditing({ slot: save.slot, label: save.label });
                          }}
                          aria-label={`修改${save.label}的名称`}
                          title="改名"
                        ><Pencil size={14} aria-hidden="true" /></button>
                      ) : null}
                      {!isCorrupt ? (
                        <button
                          type="button"
                          className="world-collection__icon-action"
                          disabled={unavailable || namedCount >= MAX_WORLD_SLOTS}
                          onClick={() => void perform(`duplicate:${save.slot}`, () => onDuplicate(save.slot))}
                          aria-label={`复制${save.label}为新收藏`}
                          title="复制分支"
                        ><Copy size={14} aria-hidden="true" /></button>
                      ) : null}
                      <button
                        type="button"
                        className="world-collection__icon-action world-collection__delete"
                        disabled={unavailable}
                        onClick={() => {
                          setEditing(null);
                          setDeletingSlot(save.slot);
                        }}
                        aria-label={`删除${save.label}`}
                        title="删除"
                      ><Trash2 size={14} aria-hidden="true" /></button>
                    </div>

                    {isDeleting ? (
                      <div className="world-collection__confirmation" role="alert">
                        <AlertTriangle size={15} aria-hidden="true" />
                        <p><strong>删除“{save.label}”？</strong><span>{save.isAutosave ? '自动续写会在世界再次保存后重新建立。' : '本机槽位将被永久移除；当前世界本身不会因此改变。'}</span></p>
                        <button type="button" disabled={unavailable} onClick={() => setDeletingSlot(null)}>取消</button>
                        <button
                          type="button"
                          disabled={unavailable}
                          onClick={() => void perform(`delete:${save.slot}`, () => onDelete(save.slot), () => setDeletingSlot(null))}
                        >{rowPending ? '删除中…' : '确认删除'}</button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="world-collection__empty">
              <Archive size={25} aria-hidden="true" />
              <strong>本机尚无史册</strong>
              <p>{canSaveCurrent
                ? '推进世界后会建立自动续写，也可以立即收藏当前分支。'
                : '开启新纪、导入史册，或返回后继续现有世界。'}</p>
              {canSaveCurrent ? (
                <button type="button" onClick={() => createInputRef.current?.focus()}>为当前世界命名</button>
              ) : null}
            </div>
          )}
        </div>

        <footer className="world-collection__footer">
          <span>收藏只保存在这台设备的浏览器中</span>
          <span>V0.1–V0.3 旧史册可继续读取</span>
        </footer>
      </section>
    </div>
  );
}
