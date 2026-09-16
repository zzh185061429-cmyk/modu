import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'motion/react';
import { cn } from '../../lib/utils';
import { X } from 'lucide-react';
import { ART } from '../../data/art';

interface TacticalButtonProps extends HTMLMotionProps<'button'> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  children: React.ReactNode;
  icon?: React.ReactNode;
  active?: boolean;
}
export function TacticalButton({ variant = 'primary', children, icon, className, active, ...props }: TacticalButtonProps) {
  return <motion.button type="button" className={cn('mato-button', `mato-button--${variant}`, active && 'is-active', className)} {...props}>
    {icon}<span>{children}</span>
  </motion.button>;
}
interface ModalProps { isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode; id?: string }
export function TacticalModal({ isOpen, onClose, title, children, id = 'mato-dialog' }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('button')?.focus());
    return () => { cancelAnimationFrame(frame); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [isOpen]);
  return <AnimatePresence>{isOpen && <div id={id} className="mato-modal" onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    if (e.key === 'Tab') {
      const controls = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]') ?? []).filter(el => el.getClientRects().length);
      const first = controls[0]; const last = controls[controls.length - 1];
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }}>
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mato-modal__backdrop" onClick={onClose} />
    <motion.div ref={ref} role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mato-modal__panel">
      <header className="mato-modal__header"><div><span className="mato-modal__index" aria-hidden="true">{id === 'modal-settings' ? '04' : id === 'modal-database' ? '01' : id === 'modal-map' ? '02' : '03'}</span><h2 id={`${id}-title`}>{title}</h2></div>
        <button id={`${id}-close-btn`} aria-label="关闭" className="mato-icon-button" onClick={onClose}><X size={20} /></button>
      </header>
      <img src={ART.chains} alt="" className="mato-modal__chain" aria-hidden="true" />
      <div className="mato-modal__content">{children}</div>
    </motion.div>
  </div>}</AnimatePresence>;
}
