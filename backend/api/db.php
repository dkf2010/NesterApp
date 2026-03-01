<?php
// backend/api/db.php

require_once dirname(__DIR__) . '/config.php';

$host = get_config('DB_HOST', 'localhost');
$db = get_config('DB_NAME', 'nester_db');
$user = get_config('DB_USER', 'root');
$pass = get_config('DB_PASS', '');
$charset = 'utf8mb4';

$dsn = "mysql:host=$host;dbname=$db;charset=$charset";
$options = [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    PDO::ATTR_EMULATE_PREPARES => false,
];

try {
    $pdo = new PDO($dsn, $user, $pass, $options);
} catch (\PDOException $e) {
    // If we can't connect, output JSON error to help debug
    header('Content-Type: application/json');
    http_response_code(500);
    echo json_encode(['error' => 'Database connection failed', 'details' => $e->getMessage()]);
    exit;
}

// Function to handle CORS so the React app (port 5173) can communicate with this API
function set_cors_headers()
{
    // Allow any localhost origin (like frontend on 5173)
    if (isset($_SERVER['HTTP_ORIGIN']) && strpos($_SERVER['HTTP_ORIGIN'], 'localhost') !== false) {
        header("Access-Control-Allow-Origin: {$_SERVER['HTTP_ORIGIN']}");
    } else {
        header("Access-Control-Allow-Origin: *");
    }
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization");

    // Handle preflight requests
    if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
        exit(0);
    }
}

// Set JSON header and CORS for all API endpoints including this file
header('Content-Type: application/json');
set_cors_headers();
?>