import React from 'react';

// Zustand immer als Punkt plus Text.
//
// Farbe allein trägt keine Aussage: wer rot von grün nicht unterscheidet, liest
// sonst nichts. Der Punkt wiederholt, was das Wort schon sagt — er ersetzt es
// nicht.
const TOENE = {
  warten: 'bg-warnung-zart text-warnung ring-warnung-rand',
  laeuft: 'bg-lauf-zart text-lauf ring-lauf-rand',
  fertig: 'bg-erfolg-zart text-erfolg ring-erfolg-rand',
  fehler: 'bg-fehler-zart text-fehler ring-fehler-rand',
  ruhend: 'bg-flaeche text-gedimmt ring-linie'
};

const PUNKTE = {
  warten: 'bg-warnung',
  laeuft: 'bg-lauf',
  fertig: 'bg-erfolg',
  fehler: 'bg-fehler',
  ruhend: 'bg-leise'
};

export default function Statuspille({ ton = 'ruhend', children, className = '' }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ring-1 text-xs font-medium ${TOENE[ton] || TOENE.ruhend} ${className}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${PUNKTE[ton] || PUNKTE.ruhend}`} />
      {children}
    </span>
  );
}
