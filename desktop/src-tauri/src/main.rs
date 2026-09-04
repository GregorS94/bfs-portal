// BFS Support — Fenster um das Portal.
//
// Bewusst dünn: Die Oberfläche ist dieselbe React-Anwendung, die auch im
// Browser läuft (frontend/). Was das Programm hinzufügt, ist das, was eine
// Webseite nicht kann — ein Fenster, das offen bleibt, ein Symbol in der
// Taskleiste, und später Benachrichtigungen, wenn die IT antwortet.
//
// Was es ausdrücklich NICHT tut: auf dem Gerät nachsehen. Das macht der
// Dienst bfs-agent, der als SYSTEM läuft und eine eigene Freigabeliste hat.
// Dieses Programm läuft mit den Rechten des angemeldeten Mitarbeiters und
// soll nie mehr dürfen als er.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("Das Fenster liess sich nicht öffnen");
}
