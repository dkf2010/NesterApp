<?php
// backend/api/auth/auth_util.php
require_once dirname(__DIR__) . '/db.php';
require_once dirname(__DIR__) . '/app_logger.php';

// Helper function to check if the provided token in the Authorization header is valid
function require_auth($pdo)
{
    if (!isset($_SERVER['HTTP_AUTHORIZATION'])) {
        http_response_code(401);
        echo json_encode(['error' => 'Missing Authorization header']);
        exit;
    }

    $authHeader = $_SERVER['HTTP_AUTHORIZATION'];
    // Expected format: "Bearer <token>"
    $parts = explode(' ', $authHeader);
    if (count($parts) !== 2 || $parts[0] !== 'Bearer') {
        http_response_code(401);
        echo json_encode(['error' => 'Invalid Authorization header format']);
        exit;
    }

    $token = $parts[1];

    $stmt = $pdo->prepare("SELECT user_id, expires_at FROM user_tokens WHERE token = ?");
    $stmt->execute([$token]);
    $tokenRow = $stmt->fetch();

    if (!$tokenRow) {
        app_log($pdo, 'warning', 'auth/token', 'Unbekannter oder ungültiger Token verwendet', [
            'endpoint' => $_SERVER['REQUEST_URI'] ?? 'unknown'
        ]);
        http_response_code(401);
        echo json_encode(['error' => 'Invalid or expired token']);
        exit;
    }

    $expiresAt = new DateTime($tokenRow['expires_at']);
    $now = new DateTime();

    if ($now > $expiresAt) {
        // Token expired, delete from DB
        $delStmt = $pdo->prepare("DELETE FROM user_tokens WHERE token = ?");
        $delStmt->execute([$token]);

        app_log($pdo, 'info', 'auth/token', 'Abgelaufene Session gelöscht', [
            'user_id' => $tokenRow['user_id']
        ], $tokenRow['user_id']);

        http_response_code(401);
        echo json_encode(['error' => 'Session expired. Please log in again.']);
        exit;
    }

    // Fetch the actual user to get the is_admin flag
    $userStmt = $pdo->prepare("SELECT id, username, email, is_admin FROM users WHERE id = ?");
    $userStmt->execute([$tokenRow['user_id']]);
    $user = $userStmt->fetch(PDO::FETCH_ASSOC);

    if (!$user) {
        app_log($pdo, 'warning', 'auth/token', 'Token gehört zu nicht mehr existierendem User', [
            'user_id' => $tokenRow['user_id']
        ]);
        http_response_code(401);
        echo json_encode(['error' => 'User no longer exists']);
        exit;
    }

    return $user;
}
?>