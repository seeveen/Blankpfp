'use client';

import { useEffect } from 'react';
import { STUDIO_HTML } from './studioHtml';

// O editor (canvas + painéis) vive em public/studio.js e é carregado uma única vez,
// depois que o HTML abaixo já está na página.
export default function StudioShell() {
  useEffect(() => {
    if (window.__studioLoaded) return;
    window.__studioLoaded = true;
    const script = document.createElement('script');
    script.src = '/studio.js?v=1';
    script.async = false;
    document.body.appendChild(script);
  }, []);

  return <div className="studio" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />;
}
