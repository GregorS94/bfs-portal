import React from 'react';

// Das Modell antwortet in Markdown. Ohne Aufbereitung standen `**14 %**` und
// `- ` wortwoertlich im Chat. Bewusst kein Markdown-Paket: gerendert wird nur,
// was das Modell hier tatsaechlich erzeugt — fett, Festbreite, Aufzaehlung.
// Alles andere bleibt Text, damit nichts als HTML interpretiert wird.

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function inline(text, keyPrefix) {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key} className="font-semibold text-tinte">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={key} className="font-mono text-[0.9em] px-1 py-0.5 rounded bg-flaeche text-tinte">{part.slice(1, -1)}</code>;
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export default function RichText({ text }) {
  const lines = String(text ?? '').split('\n');

  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="select-none opacity-60">•</span>
              <span>{inline(bullet[1], i)}</span>
            </div>
          );
        }
        // Leerzeile haelt den Absatzabstand, sonst klebt alles aneinander.
        if (!line.trim()) return <div key={i} className="h-2" />;
        return <p key={i}>{inline(line, i)}</p>;
      })}
    </div>
  );
}
