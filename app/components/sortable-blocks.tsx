'use client';
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { GripVertical, Trash2 } from 'lucide-react';
import { type Block } from '@/lib/article';
import { blockDropIndex, blockScrollStep, type BlockBounds } from '@/lib/block-order';

type Props = {
  blocks: Block[];
  onMove: (id: string, index: number) => void;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  children: (block: Block, index: number) => ReactNode;
};
type Preview = { id: string; target: string; edge: 'before' | 'after'; x: number; y: number; width: number; text: string };
type Gesture = {
  id: string; pointerId: number; target: HTMLButtonElement; active: boolean;
  startX: number; startY: number; x: number; y: number; frame: number; lastTime: number;
  timer: ReturnType<typeof setTimeout> | null; bounds: BlockBounds[] | null;
  scroll: HTMLElement; cleanup: () => void;
};

export default function SortableBlocks({ blocks, onMove, onSelect, onRemove, children }: Props) {
  const list = useRef<HTMLDivElement>(null), gesture = useRef<Gesture | null>(null);
  const current = useRef({ blocks, onMove, onSelect });
  current.current = { blocks, onMove, onSelect };
  const [preview, setPreview] = useState<Preview | null>(null), [menu, setMenu] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const suppressClick = useRef(''), helpId = useId();

  function boundsFor(session: Gesture) {
    if (!session.bounds) {
      const top = list.current!.getBoundingClientRect().top;
      session.bounds = Array.from(list.current!.querySelectorAll<HTMLElement>('[data-sortable-block]'))
        .filter(row => row.dataset.sortableBlock !== session.id)
        .map(row => { const rect = row.getBoundingClientRect(); return { id: row.dataset.sortableBlock!, top: rect.top - top, height: rect.height }; });
    }
    return session.bounds;
  }
  function destination(session: Gesture) {
    return blockDropIndex(boundsFor(session), session.y - list.current!.getBoundingClientRect().top);
  }
  function finish(apply: boolean, updateView = true) {
    const session = gesture.current;
    if (!session) return;
    const index = apply && session.active && list.current ? destination(session) : -1;
    gesture.current = null;
    if (session.timer) clearTimeout(session.timer);
    cancelAnimationFrame(session.frame); session.cleanup();
    if (session.target.hasPointerCapture?.(session.pointerId)) session.target.releasePointerCapture(session.pointerId);
    if (session.active) {
      suppressClick.current = session.id;
      if (index >= 0) {
        current.current.onMove(session.id, index);
        if (updateView) setAnnouncement('Блок перемещён. Позиция ' + (index + 1) + ' из ' + current.current.blocks.length + '.');
      } else if (updateView) setAnnouncement('Перемещение отменено.');
    }
    if (updateView) setPreview(null);
  }
  function frame(time: number) {
    const session = gesture.current;
    if (!session?.active || !list.current) return;
    const block = current.current.blocks.find(item => item.id === session.id);
    if (!block) { finish(false); return; }
    const rect = session.scroll.getBoundingClientRect();
    session.scroll.scrollTop += blockScrollStep(session.y, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom), session.lastTime ? time - session.lastTime : 16);
    session.lastTime = time;
    const bounds = boundsFor(session), index = destination(session);
    const target = bounds[index] || bounds.at(-1), width = Math.min(260, window.innerWidth - 24);
    const next: Preview = {
      id: session.id, target: target?.id || '', edge: index < bounds.length ? 'before' : 'after',
      x: Math.max(12, Math.min(window.innerWidth - width - 12, session.x + 16)),
      y: Math.max(12, Math.min(window.innerHeight - 80, session.y - 64)), width,
      text: block.text.trim().slice(0, 90) || (block.type === 'image' ? 'Изображение' : block.type === 'divider' ? 'Разделитель' : 'Пустой блок'),
    };
    setPreview(previous => previous && Object.keys(next).every(key => previous[key as keyof Preview] === next[key as keyof Preview]) ? previous : next);
    session.frame = requestAnimationFrame(frame);
  }
  function activate(session: Gesture) {
    if (gesture.current !== session || session.active) return;
    session.active = true; setMenu(''); current.current.onSelect(session.id);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    setAnnouncement('Перетаскивайте блок. Отпустите, чтобы поставить его на выбранное место.');
    session.frame = requestAnimationFrame(frame);
  }
  function start(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (!event.isPrimary || event.button !== 0 || current.current.blocks.length < 2 || gesture.current) return;
    suppressClick.current = '';
    const scroll = list.current?.closest<HTMLElement>('.canvas-scroll');
    if (!scroll) return;
    const session: Gesture = { id, pointerId: event.pointerId, target: event.currentTarget, active: false,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, frame: 0, lastTime: 0,
      timer: null, bounds: null, scroll, cleanup: () => {} };
    gesture.current = session;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Window listeners still handle the gesture. */ }
    function move(e: PointerEvent) {
      if (e.pointerId !== session.pointerId) return;
      session.x = e.clientX; session.y = e.clientY;
      if (!session.active && Math.hypot(e.clientX - session.startX, e.clientY - session.startY) >= 7) activate(session);
      if (session.active) e.preventDefault();
    }
    function up(e: PointerEvent) { if (e.pointerId === session.pointerId) { session.x = e.clientX; session.y = e.clientY; finish(true); } }
    function cancel(e: PointerEvent) { if (e.pointerId === session.pointerId) finish(false); }
    function blur() { finish(false); }
    function key(e: KeyboardEvent) { if (e.key === 'Escape') { e.preventDefault(); finish(false); } }
    function invalidate() { session.bounds = null; }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(invalidate);
    observer?.observe(list.current!);
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', blur); window.addEventListener('keydown', key); window.addEventListener('resize', invalidate);
    session.target.addEventListener('lostpointercapture', blur);
    session.cleanup = () => {
      observer?.disconnect(); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel); window.removeEventListener('blur', blur);
      window.removeEventListener('keydown', key); window.removeEventListener('resize', invalidate);
      session.target.removeEventListener('lostpointercapture', blur);
    };
    session.timer = setTimeout(() => activate(session), event.pointerType === 'mouse' ? 250 : 180);
  }
  useEffect(() => () => finish(false, false), []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => { if (!(e.target instanceof Element) || e.target.closest('[data-block-options]')?.getAttribute('data-block-options') !== menu) setMenu(''); };
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(''); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [menu]);

  return <div className={'editable-blocks article-body' + (preview ? ' is-reordering' : '')} ref={list}>
    <p className="block-drag-help" id={helpId}><GripVertical size={15} />Зажмите точки и перетащите блок<span className="sr-only">. С клавиатуры используйте стрелки вверх и вниз. Escape отменяет перемещение. Нажатие открывает меню блока.</span></p>
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    {blocks.map((block, index) => <div key={block.id} data-sortable-block={block.id} className={'editable-block-row row-' + block.type + (menu === block.id ? ' has-block-menu' : '') + (preview?.id === block.id ? ' block-dragging' : '') + (preview?.target === block.id ? ' drop-' + preview.edge : '')}>
      <div className="block-controls" data-block-options={block.id}>
        <button type="button" className="block-grip" aria-label={'Переместить блок ' + (index + 1)} title="Зажмите и перетащите; нажмите для меню" aria-describedby={helpId} aria-expanded={menu === block.id} aria-haspopup="menu" aria-keyshortcuts="ArrowUp ArrowDown" onContextMenu={e => e.preventDefault()} onPointerDown={e => start(e, block.id)} onClick={e => {
          e.stopPropagation();
          if (suppressClick.current === block.id) { suppressClick.current = ''; e.preventDefault(); return; }
          setMenu(menu === block.id ? '' : block.id); current.current.onSelect(block.id);
        }} onKeyDown={e => {
          if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') { suppressClick.current = ''; return; }
          e.preventDefault(); suppressClick.current = ''; setMenu('');
          const target = Math.max(0, Math.min(blocks.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1)));
          current.current.onMove(block.id, target); current.current.onSelect(block.id);
          setAnnouncement('Блок перемещён. Позиция ' + (target + 1) + ' из ' + blocks.length + '.');
        }}><GripVertical size={20} /></button>
        {menu === block.id && <div className="dropdown block-dropdown" role="menu"><button type="button" role="menuitem" className="danger" onClick={() => { onRemove(block.id); setMenu(''); }}><Trash2 size={15} />Удалить блок</button></div>}
      </div>
      {children(block, index)}
    </div>)}
    {preview && <div className="block-drag-preview" aria-hidden="true" style={{ left: preview.x, top: preview.y, width: preview.width }}><GripVertical size={20} /><span>{preview.text}</span></div>}
  </div>;
}
