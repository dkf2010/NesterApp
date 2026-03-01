<?php
// backend/api/update_nest_name.php
require_once 'db.php';
require_once 'auth/auth_util.php';

$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['id']) || !isset($data['name'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("UPDATE taubennester SET name = ? WHERE id = ?");
    $stmt->execute([$data['name'], $data['id']]);

    $logId = bin2hex(random_bytes(18));
    $actionText = 'Name geändert zu: ' . $data['name'];
    $logStmt = $pdo->prepare("INSERT INTO taubennest_logs (id, nest_id, user_id, action, timestamp) VALUES (?, ?, ?, ?, ?)");
    $logStmt->execute([
        $logId,
        $data['id'],
        $currentUser['id'],
        $actionText,
        date('Y-m-d H:i:s')
    ]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>