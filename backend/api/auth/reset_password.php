<?php
// backend/api/auth/reset_password.php
require_once dirname(__DIR__) . '/db.php';

$data = json_decode(file_get_contents('php://input'), true);

if (!isset($data['token']) || !isset($data['new_password'])) {
    http_response_code(400);
    echo json_encode(['error' => 'Missing data']);
    exit;
}

try {
    $token = $data['token'];

    // Check if token is valid and not expired
    $stmt = $pdo->prepare("SELECT email, expires_at FROM password_resets WHERE token = ?");
    $stmt->execute([$token]);
    $resetRow = $stmt->fetch();

    if (!$resetRow) {
        http_response_code(400);
        echo json_encode(['error' => 'Invalid token']);
        exit;
    }

    $expiresAt = new DateTime($resetRow['expires_at']);
    $now = new DateTime();

    if ($now > $expiresAt) {
        http_response_code(400);
        echo json_encode(['error' => 'Token has expired']);
        exit;
    }

    // Hash new password
    $newHash = password_hash($data['new_password'], PASSWORD_DEFAULT);

    // Update user
    $updStmt = $pdo->prepare("UPDATE users SET password_hash = ? WHERE email = ?");
    $updStmt->execute([$newHash, $resetRow['email']]);

    // Delete used reset token
    $delStmt = $pdo->prepare("DELETE FROM password_resets WHERE email = ?");
    $delStmt->execute([$resetRow['email']]);

    echo json_encode(['success' => true]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>