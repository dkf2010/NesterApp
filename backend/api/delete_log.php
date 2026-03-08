<?php
// backend/api/delete_log.php

require_once 'db.php';
require_once 'auth/auth_util.php';

// Only allow POST requests (OPTIONS is handled by db.php)
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['error' => 'Method not allowed']);
    exit;
}

// 1. Authenticate the user
$user = require_auth($pdo);

// 2. Check if user is admin
if (!$user['is_admin']) {
    http_response_code(403);
    echo json_encode(['error' => 'Only administrators can delete logs']);
    exit;
}

// 3. Get the log ID from the JSON body
$data = json_decode(file_get_contents('php://input'), true);
if (!isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Log ID is required']);
    exit;
}

$logId = $data['id'];

try {
    // 4. Delete the log entry
    $stmt = $pdo->prepare("DELETE FROM taubennest_logs WHERE id = ?");
    $stmt->execute([$logId]);

    // 5. Check if any row was affected (deleted)
    if ($stmt->rowCount() > 0) {
        http_response_code(200);
        echo json_encode(['success' => true, 'message' => 'Log deleted successfully']);
    } else {
        http_response_code(404);
        echo json_encode(['error' => 'Log not found']);
    }
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'Database error', 'details' => $e->getMessage()]);
}
?>