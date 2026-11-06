# Mayleens Lauftrainer – iPad-Ausgabe 2.0.0

Statische Web-App (PWA) für Safari auf dem iPad. Keine Abhängigkeiten, kein Build-Schritt, keine Serverlogik.

1. Inhalt dieses Ordners per **HTTPS** bereitstellen (GitHub Pages, Caddy, nginx …).
2. Auf dem iPad in Safari öffnen › Teilen › **Zum Home-Bildschirm**.
3. Über das neue Symbol öffnen und einrichten.

Lokal testen: `python -m http.server 8000` → http://localhost:8000

Ausführliche Anleitung: `Handbuch/Handbuch-Mayleens-Lauftrainer.pdf`

Updates: Dateien ersetzen und in `sw.js` die Konstante `CACHE` hochzählen.
