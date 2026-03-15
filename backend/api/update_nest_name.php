<?php
// backend/api/update_nest_name.php
require_once 'db.php';
require_once 'auth/auth_util.php';
require_once 'app_logger.php';

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

    app_log($pdo, 'info', 'api/update_nest_name', "Nest umbenannt zu: {$data['name']}", [
        'nest_id' => $data['id']
    ], $currentUser['id']);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    app_log($pdo, 'error', 'api/update_nest_name', 'Fehler beim Umbenennen des Nests', [
        'exception' => $e->getMessage(),
        'nest_id' => $data['id'] ?? null
    ], $currentUser['id']);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>