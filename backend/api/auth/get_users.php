<?php
// backend/api/auth/get_users.php
require_once dirname(__DIR__) . '/db.php';
require_once 'auth_util.php';

// Only logged in admins can view the list of users
$currentUser = require_auth($pdo);

if (!$currentUser['is_admin']) {
    http_response_code(403);
    echo json_encode(['error' => 'Forbidden: Only administrators can view users.']);
    exit;
}

try {
    // We intentionally exclude password_hash for security
    $stmt = $pdo->query("SELECT id, username, email, created_at FROM users ORDER BY created_at DESC");
    $users = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo json_encode($users);
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
?>