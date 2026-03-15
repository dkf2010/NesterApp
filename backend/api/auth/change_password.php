<?php
// backend/api/auth/change_password.php
require_once dirname(__DIR__) . '/db.php';
require_once 'auth_util.php';
require_once dirname(__DIR__) . '/app_logger.php';

// First, authenticate token
$currentUser = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['current_password']) || !isset($data['new_password'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$currentUser['id']]);
    $user = $stmt->fetch();

    if ($user && password_verify($data['current_password'], $user['password_hash'])) {
        $newHash = password_hash($data['new_password'], PASSWORD_DEFAULT);

        $updStmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $updStmt->execute([$newHash, $currentUser['id']]);

        app_log($pdo, 'info', 'auth/change_password', 'Passwort erfolgreich geändert', null, $currentUser['id']);

        echo json_encode(['success' => true]);
    } else {
        app_log($pdo, 'warning', 'auth/change_password', 'Fehlgeschlagene Passwort-Änderung (falsches aktuelles Passwort)', null, $currentUser['id']);
        http_response_code(401);
        echo json_encode(['error' => 'Incorrect current password']);
    }
} catch (Exception $e) {
    app_log($pdo, 'error', 'auth/change_password', 'Fehler beim Passwort-Ändern', [
        'exception' => $e->getMessage()
    ], $currentUser['id']);
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>