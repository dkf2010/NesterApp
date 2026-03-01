<?php
// backend/api/auth/change_password.php
require_once dirname(__DIR__) . '/db.php';
require_once 'auth_util.php';

// First, authenticate token
$user_id = require_auth($pdo);

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['current_password']) || !isset($data['new_password'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $stmt = $pdo->prepare("SELECT password_hash FROM users WHERE id = ?");
    $stmt->execute([$user_id]);
    $user = $stmt->fetch();

    if ($user && password_verify($data['current_password'], $user['password_hash'])) {
        $newHash = password_hash($data['new_password'], PASSWORD_DEFAULT);

        $updStmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE id = ?");
        $updStmt->execute([$newHash, $user_id]);

        echo json_encode(['success' => true]);
    } else {
        http_response_code(401);
        echo json_encode(['error' => 'Incorrect current password']);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>