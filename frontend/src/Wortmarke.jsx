import React from 'react';

// Wortmarke statt Maskottchen.
//
// Bewusst kein Nachbau des BFS-Logos: das gehört der Firma und liegt hier nicht
// als Datei vor. Sobald das echte Logo als SVG vorliegt, ersetzt es diese Datei.
//
// `hell` ist die Fassung für die dunkle Seitenspalte — dort trägt der Text sich
// nicht selbst, sondern steht auf Marine. `mittig` zentriert auch den Strich:
// ohne das bleibt er linksbündig stehen, während der Text darüber mittig sitzt.
export default function Wortmarke({ className = '', klein = false, hell = false, mittig = false }) {
  const schrift = hell ? 'text-white' : 'text-tinte';
  const unterzeile = hell ? 'text-white/60' : 'text-gedimmt';
  return (
    <div className={className}>
      <div className={`font-semibold tracking-tight leading-none ${schrift} ${klein ? 'text-lg' : 'text-3xl'}`}>
        BFS
      </div>
      <div className={`leading-tight ${unterzeile} ${klein ? 'text-[11px]' : 'text-base'}`}>
        IT-Service
      </div>
      <div className={`h-[2px] bg-akzent mt-1.5 ${mittig ? 'mx-auto' : ''}`} style={{ width: klein ? 26 : 34 }} />
    </div>
  );
}
