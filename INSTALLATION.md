# Installationsanleitung

## Tech-Stack
- **Frontend**: React (Vite), React-Leaflet
- **Backend**: PHP 8+, MySQL

## Voraussetzungen
- Node.js (v18+)
- Lokale Serverumgebung für PHP und MySQL (z.B. XAMPP, MAMP, DDEV, Docker)

## Schritt-für-Schritt Einrichtung

1. **Repository klonen**
   ```bash
   git clone https://github.com/your-username/NesterApp.git
   cd NesterApp
   ```

2. **Backend Einrichtung**
   - Erstelle eine neue MySQL-Datenbank (z.B. `nester_db`).
   - Importiere das Datenbankschema aus `backend/schema.sql` in deine neue Datenbank.
   - Führe die Anwendung auf deinem lokalen PHP-Server (z.B. MAMP/XAMPP) aus, sodass `backend/api/` über `http://localhost/...` erreichbar ist.
   - Kopiere `.env.example` nach `.env` im Stammverzeichnis und aktualisiere deine Datenbank-Zugangsdaten.
   - Setze die korrekten Berechtigungen für die `.env` Datei:
     ```bash
     chmod 600 .env
     ```

3. **Frontend Einrichtung**
   - Installiere die Abhängigkeiten:
     ```bash
     npm install
     ```
   - Stelle sicher, dass deine `.env` die korrekte API-URL enthält:
     ```env
     VITE_API_BASE_URL=http://localhost/NesterApp/backend/api
     ```
   - Starte den Entwicklungsserver:
     ```bash
     npm run dev
     ```

## Produktions-Build

Um die React-App für die Produktion zu erstellen:
```bash
npm run build
```
Dies generiert ein `dist/`-Verzeichnis. Lade den Inhalt von `dist/` und `backend/` auf deinen Produktions-Webserver hoch.
