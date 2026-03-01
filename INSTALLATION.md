# Installation Guide

## Tech Stack
- **Frontend**: React (Vite), React-Leaflet
- **Backend**: PHP 8+, MySQL

## Prerequisites
- Node.js (v18+)
- Local server environment for PHP and MySQL (e.g., XAMPP, MAMP, DDEV, Docker)

## Step-by-Step Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-username/NesterApp.git
   cd NesterApp
   ```

2. **Backend Setup**
   - Create a new MySQL database (e.g., `nester_db`).
   - Import the database schema from `backend/schema.sql` into your new database.
   - Run the application on your local PHP server (e.g. MAMP/XAMPP) so `backend/api/` is accessible via `http://localhost/...`
   - Copy `.env.example` to `.env` in the root folder and update your database credentials.

3. **Frontend Setup**
   - Install dependencies:
     ```bash
     npm install
     ```
   - Make sure your `.env` contains the correct API URL:
     ```env
     VITE_API_BASE_URL=http://localhost/NesterApp/backend/api
     ```
   - Start the development server:
     ```bash
     npm run dev
     ```

## Production Build

To build the React app for production:
```bash
npm run build
```
This generates a `dist/` directory. Upload the contents of `dist/` and `backend/` to your production web server.
