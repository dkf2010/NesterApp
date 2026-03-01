<?php
// backend/api/add_log.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['nest_id']) || !isset($data['action']) || !isset($data['id'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("INSERT INTO taubennest_logs (id, nest_id, user_id, action, timestamp) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([
        $data['id'],
        $data['nest_id'],
        $currentUser['id'],
        $data['action'],
        date('Y-m-d H:i:s')
    ]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>