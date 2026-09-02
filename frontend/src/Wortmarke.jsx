import React from 'react';

// Wortmarke statt Maskottchen.
//
// Bewusst kein Nachbau des BFS-Logos: das gehört der Firma und liegt hier nicht
// als Datei vor. Stattdessen dieselbe Sprache — Lato, das warme Fast-Schwarz der
// Website, und der kurze orangefarbene Strich, mit dem dort jede Überschrift
// unterlegt ist. Sobald das echte Logo als SVG vorliegt, ersetzt es diese Datei.
export default function Wortmarke({ className = '', klein = false }) {
  return (
    <div className={className}>
      <div className={`font-kopf font-black tracking-tight text-tinte leading-none ${klein ? 'text-lg' : 'text-2xl'}`}>
        BFS
      </div>
      <div className={`font-kopf text-tinte leading-tight ${klein ? 'text-[11px]' : 'text-sm'}`}>
        Self-Service Portal
      </div>
      <div className="h-[2px] bg-akzent mt-1.5" style={{ width: klein ? 26 : 34 }} />
    </div>
  );
}
