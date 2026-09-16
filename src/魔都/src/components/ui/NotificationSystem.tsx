import React from 'react';
import { AlertCircle, CircleCheckBig, Info, AlertTriangle, X } from 'lucide-react';
import { NotificationItem } from '../../types';
interface NotificationSystemProps { notifications: NotificationItem[]; removeNotification: (id: string) => void }
export function NotificationSystem({ notifications, removeNotification }: NotificationSystemProps) {
  const icons = { info: Info, success: CircleCheckBig, warning: AlertTriangle, error: AlertCircle };
  return <div className="mato-notices" aria-live="polite">{notifications.map(note => {
    const Icon = icons[note.type];
    return <section className="mato-notice" data-type={note.type} key={note.id}><Icon size={20} /><div><h4>{note.title}</h4><p>{note.message}</p></div><button aria-label="关闭通知" onClick={() => removeNotification(note.id)}><X size={16} /></button></section>;
  })}</div>;
}
