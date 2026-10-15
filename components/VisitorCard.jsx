'use client';

import { useEffect, useState } from 'react';

export default function VisitorCard() {
  const [total, setTotal] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let off = false;
    fetch('/api/visit', { method: 'POST' })
      .then((r) => r.json())
      .then((d) => {
        if (off) return;
        if (typeof d.total === 'number') setTotal(d.total);
        else setFailed(true);
      })
      .catch(() => {
        if (!off) setFailed(true);
      });
    return () => {
      off = true;
    };
  }, []);

  return (
    <div className="vcard" role="status" aria-live="polite">
      <div className="vi" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </div>
      <div>
        <small>Visitantes</small>
        <b id="visit-count">{failed ? '—' : total === null ? '…' : total.toLocaleString('pt-BR')}</b>
      </div>
      <div className="vd">pessoas diferentes
        <br />
        (contadas por IP)</div>
    </div>
  );
}
