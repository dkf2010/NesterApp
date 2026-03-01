<?php
// backend/api/create_nest.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id']) || !isset($data['lat']) || !isset($data['lng'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $createdAt = date('Y-m-d H:i:s');
    $name = isset($data['name']) ? $data['name'] : null;

    // Insert the nest
    $stmt = $pdo->prepare("INSERT INTO taubennester (id, name, lat, lng, created_at) VALUES (?, ?, ?, ?, ?)");
    $stmt->execute([
        $data['id'],
        $name,
        $data['lat'],
        $data['lng'],
        $createdAt
    ]);

    // Insert the "Nest angelegt" log entry automatically
    $logId = bin2hex(random_bytes(18));
    $actionText = $name ? 'Nest angelegt: ' . $name : 'Nest angelegt';

    $logStmt = $pdo->prepare("INSERT INTO taubennest_logs (id, nest_id, user_id, action, timestamp) VALUES (?, ?, ?, ?, ?)");
    $logStmt->execute([
        $logId,
        $data['id'],
        $currentUser['id'],
        $actionText,
        $createdAt
    ]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>